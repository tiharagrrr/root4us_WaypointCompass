import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { alertMachine, type Actor } from '@waypoint/shared';
import { and, eq, ne, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import { StateConflictError } from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { EventPayload } from '../../../core/persistence/ports';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { alerts } from '../../../db/schema';
import { AuditService } from '../../audit';
import {
  ALERT_AUDIT,
  ALERT_EVENTS,
  ALERT_LOGS,
  type AlertSeverity,
} from '../alerts.constants';
import type { RaiseIntent } from '../domain/alert-rules';
import type { AlertEvent } from '../events/alerts.events';
import { AlertScope } from '../policies/alert.scope';

export type AlertRow = typeof alerts.$inferSelect;

/** What an alert's audit row keeps: the fields a reviewer reads. */
const auditShape = (a: AlertRow) => ({
  type: a.type,
  status: a.status,
  severity: a.severity,
  depotId: a.depotId,
  dedupeKey: a.dedupeKey,
  title: a.title,
  detail: a.detail,
  acknowledgedById: a.acknowledgedById,
  resolvedById: a.resolvedById,
  resolution: a.resolution,
});

/**
 * Every change to an alert: raised by a rule, acknowledged or resolved by a
 * dispatcher, or closed by the fix happening. Each method is one use case in
 * one transaction holding the write, its audit row and its outbox event, so
 * none of the three can exist without the others (architecture rule 4).
 *
 * Two things shape the whole service:
 *
 * - **One open alert per dedupe key.** `raise` is an upsert, not an insert.
 *   The partial unique index `alerts_open_dedupe_uq` is the authority, so two
 *   late-risk updates for the same stop give one alert whatever order the
 *   relay delivers them in (AC-ALR-02), and a repeat raise refreshes the
 *   detail instead of adding a row and re-announcing itself (AC-ALR-10).
 * - **Alerts never block.** Nothing here refuses another module's work. The
 *   only refusals are a dispatcher acknowledging or resolving twice, which is
 *   about the alert itself, never about the fix (AC-ALR-11).
 */
@Injectable()
export class AlertsService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: AlertScope,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(AlertsService.name);
  }

  /**
   * Raises the alert an intent describes, or refreshes the open one that
   * already holds its key. `raised` says which happened: a refresh emits no
   * event and writes no audit row, because nothing about the alert's state
   * changed — only the facts it is showing.
   *
   * Runs inside the listener's transaction, so the alert and the receipt that
   * marks its event handled commit together.
   */
  async raise(
    intent: RaiseIntent,
    depotId: string,
    attempt = 1,
  ): Promise<{ alert: AlertRow; raised: boolean }> {
    const existing = await this.refresh(intent);
    if (existing) return { alert: existing, raised: false };

    const now = this.clock.now();
    const [inserted] = await this.txHost.tx
      .insert(alerts)
      .values({
        type: intent.type,
        status: 'OPEN',
        severity: intent.severity,
        depotId,
        tripId: intent.tripId,
        stopId: intent.stopId,
        orderId: intent.orderId,
        outletId: intent.outletId,
        title: intent.title,
        detail: intent.detail,
        dedupeKey: intent.dedupeKey,
        raisedById: intent.raisedById,
        raisedAt: now,
      })
      // A concurrent raise for the same key won the race; fall through to the
      // refresh below, which turns this call into the update it should be.
      // `where` is the index predicate, so this targets exactly
      // `alerts_open_dedupe_uq` and not some future index on dedupeKey.
      .onConflictDoNothing({
        target: alerts.dedupeKey,
        where: ne(alerts.status, 'RESOLVED'),
      })
      .returning();

    if (!inserted) {
      const row = await this.refresh(intent);
      if (row) return { alert: row, raised: false };
      // The racing writer resolved its own alert between the two statements,
      // which frees the key again. One retry: a second loss would mean the
      // key is being raised and resolved faster than a statement runs, and
      // raising nothing is better than spinning inside the relay.
      if (attempt > 1)
        throw new StateConflictError(
          `The alert for ${intent.dedupeKey} is being changed by another writer.`,
        );
      return this.raise(intent, depotId, attempt + 1);
    }

    await this.audit.record({
      action: ALERT_AUDIT.raised,
      entity: ['alert', inserted.id],
      after: auditShape(inserted),
      source: 'SYSTEM',
      occurredAt: now,
    });
    await this.emit(ALERT_EVENTS.raised, inserted);
    this.log.info(
      {
        event: ALERT_LOGS.raised,
        alertId: inserted.id,
        type: inserted.type,
        severity: inserted.severity,
        depotId,
      },
      'alert raised',
    );
    return { alert: inserted, raised: true };
  }

  /**
   * "I'm on it": the alert stays in the list, now carrying who took it, so
   * two dispatchers do not both chase the same problem (AC-ALR-08).
   */
  @Transactional()
  async acknowledge(id: string, actor: Actor): Promise<AlertRow> {
    const before = await this.load(id, actor);
    this.assertCan(before, 'ACKNOWLEDGE');

    const now = this.clock.now();
    const after = await this.set(id, {
      status: 'ACKNOWLEDGED',
      acknowledgedById: actor.id,
      acknowledgedAt: now,
    });

    await this.audit.record({
      action: ALERT_AUDIT.acknowledged,
      entity: ['alert', id],
      before: auditShape(before),
      after: auditShape(after),
      occurredAt: now,
    });
    await this.emit(ALERT_EVENTS.acknowledged, after);
    return after;
  }

  /** A dispatcher closes the alert by hand, saying what they did about it. */
  @Transactional()
  async resolve(id: string, actor: Actor, note: string): Promise<AlertRow> {
    const before = await this.load(id, actor);
    this.assertCan(before, 'RESOLVE');

    const now = this.clock.now();
    const after = await this.set(id, {
      status: 'RESOLVED',
      resolvedById: actor.id,
      resolvedAt: now,
      resolution: note,
    });

    await this.audit.record({
      action: ALERT_AUDIT.resolved,
      entity: ['alert', id],
      before: auditShape(before),
      after: auditShape(after),
      reasonNote: note,
      occurredAt: now,
    });
    await this.emit(ALERT_EVENTS.resolved, after);
    return after;
  }

  /**
   * The fix happened, so the alert closes itself: no `resolvedById`, no note,
   * and nothing for the dispatcher to do (AC-ALR-03, AC-ALR-04).
   *
   * Returns null when no open alert holds the key, which is the ordinary case
   * for most events — a delivered stop that was never at risk of being late
   * still publishes `stop.completed`. Runs inside the listener's transaction.
   */
  async autoResolve(dedupeKey: string): Promise<AlertRow | null> {
    const now = this.clock.now();
    const [before] = await this.txHost.tx
      .select()
      .from(alerts)
      .where(
        and(eq(alerts.dedupeKey, dedupeKey), ne(alerts.status, 'RESOLVED')),
      )
      .limit(1);
    if (!before) return null;

    const after = await this.set(before.id, {
      status: 'RESOLVED',
      resolvedAt: now,
    });

    await this.audit.record({
      action: ALERT_AUDIT.autoResolved,
      entity: ['alert', after.id],
      before: auditShape(before),
      after: auditShape(after),
      source: 'SYSTEM',
      occurredAt: now,
    });
    await this.emit(ALERT_EVENTS.resolved, after);
    this.log.info(
      {
        event: ALERT_LOGS.autoResolved,
        alertId: after.id,
        type: after.type,
        minutesOpen: minutesBetween(after.raisedAt, now),
        depotId: after.depotId,
      },
      'alert resolved itself',
    );
    return after;
  }

  /**
   * Updates the open alert for this key with the latest facts, or null when
   * the key has none. One statement, so it cannot act on a row that another
   * writer resolved in between.
   */
  private async refresh(intent: RaiseIntent): Promise<AlertRow | undefined> {
    const [row] = await this.txHost.tx
      .update(alerts)
      .set({
        severity: intent.severity,
        title: intent.title,
        detail: intent.detail,
      })
      .where(
        and(
          eq(alerts.dedupeKey, intent.dedupeKey),
          ne(alerts.status, 'RESOLVED'),
        ),
      )
      .returning();
    return row;
  }

  /** The alert within the actor's scope, or 404 (architecture rule 5). */
  private async load(id: string, actor: Actor): Promise<AlertRow> {
    const [row] = await this.txHost.tx
      .select()
      .from(alerts)
      .where(and(eq(alerts.id, id), this.scope.where(actor) ?? sql`true`))
      .limit(1);
    return this.scope.found(row);
  }

  private async set(
    id: string,
    values: Partial<typeof alerts.$inferInsert>,
  ): Promise<AlertRow> {
    const [row] = await this.txHost.tx
      .update(alerts)
      .set(values)
      .where(eq(alerts.id, id))
      .returning();
    return row;
  }

  /**
   * Alerts have no version column, so there is no If-Match to be stale
   * against: a second acknowledge or resolve is a state conflict, not a
   * concurrency one (AC-ALR-08).
   */
  private assertCan(alert: AlertRow, event: 'ACKNOWLEDGE' | 'RESOLVE'): void {
    if (!alertMachine.can(alert.status, event))
      throw new StateConflictError(
        `This alert is already ${alert.status.toLowerCase()}.`,
      );
  }

  private async emit(type: string, alert: AlertRow): Promise<void> {
    const payload: AlertEvent = {
      v: 1,
      alertId: alert.id,
      type: alert.type,
      severity: alert.severity as AlertSeverity,
      status: alert.status,
      depotId: alert.depotId,
      dedupeKey: alert.dedupeKey,
      tripId: alert.tripId,
      stopId: alert.stopId,
      orderId: alert.orderId,
      outletId: alert.outletId,
      resolvedById: alert.resolvedById,
    };
    await this.outbox.add(type, payload as unknown as EventPayload, {
      aggregate: ['alert', alert.id],
      depotId: alert.depotId,
      outletIds: alert.outletId ? [alert.outletId] : [],
    });
  }
}

/** Whole minutes between two instants, for the auto-resolve log line. */
export const minutesBetween = (from: Date, to: Date): number =>
  Math.round((to.getTime() - from.getTime()) / 60_000);
