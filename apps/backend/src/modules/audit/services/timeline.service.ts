import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { and, asc, eq, inArray, or, type SQL } from 'drizzle-orm';
import { ClockService } from '../../../core/clock/clock.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import {
  auditEvents,
  deferrals,
  issues,
  loadCheckLines,
  orders,
  receipts,
  stops,
} from '../../../db/schema';
import { syncedLate } from '../domain/synced-late';
import type { TimelineEntryDto } from '../dto/timeline.dto';
import { OrderTimelineScope } from '../policies/timeline.scope';

export type TimelineEntry = Omit<TimelineEntryDto, '_links'>;

type AuditRow = typeof auditEvents.$inferSelect;

/**
 * An order's history, merged across the modules that touched it: the order's own audit
 * rows with those of its stops, their trips, its deferrals, load lines, receipt and
 * issues, in the order they happened.
 *
 * The related ids are read straight from the other modules' tables, read-only, so audit
 * imports none of them (ordering, planning and the rest already import audit to record).
 * Before and after snapshots stay out of the response: a trip's snapshot carries other
 * outlets' stops, which a store must not see.
 */
@Injectable()
export class TimelineService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: OrderTimelineScope,
    private readonly clock: ClockService,
  ) {}

  /** The order's entries, oldest first; 404 when it is missing or outside the scope. */
  async forOrder(orderId: string, actor: Actor): Promise<TimelineEntry[]> {
    const tx = this.txHost.tx;
    const [order] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.id, orderId), this.scope.where(actor)));
    this.scope.found(order);

    const [stopRows, deferralRows, loadLineRows, receiptRows, issueRows] =
      await Promise.all([
        tx
          .select({ id: stops.id, tripId: stops.tripId })
          .from(stops)
          .where(eq(stops.orderId, orderId)),
        tx
          .select({ id: deferrals.id })
          .from(deferrals)
          .where(eq(deferrals.orderId, orderId)),
        tx
          .select({ id: loadCheckLines.id })
          .from(loadCheckLines)
          .where(eq(loadCheckLines.orderId, orderId)),
        tx
          .select({ id: receipts.id })
          .from(receipts)
          .where(eq(receipts.orderId, orderId)),
        tx
          .select({ id: issues.id })
          .from(issues)
          .where(eq(issues.orderId, orderId)),
      ]);

    const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
    const related: [type: string, ids: string[]][] = [
      ['order', [orderId]],
      ['stop', ids(stopRows)],
      ['trip', [...new Set(stopRows.map((stop) => stop.tripId))]],
      ['deferral', ids(deferralRows)],
      ['load_line', ids(loadLineRows)],
      ['receipt', ids(receiptRows)],
      ['issue', ids(issueRows)],
    ];
    const of = related
      .filter(([, entityIds]) => entityIds.length > 0)
      .map(([type, entityIds]) =>
        and(
          eq(auditEvents.entityType, type),
          inArray(auditEvents.entityId, entityIds),
        ),
      )
      .filter((clause): clause is SQL => clause !== undefined);

    const rows = await tx
      .select()
      .from(auditEvents)
      .where(or(...of))
      .orderBy(asc(auditEvents.occurredAt), asc(auditEvents.seq));
    // occurredAt is business time and recordedAt the wall clock, so the two only compare
    // while the demo clock is off. With it on, the writer's own verdict stands: execution
    // and loading mark a late replay OFFLINE_SYNC, judged on one clock when it arrived.
    const sameClock = this.clock.mode().mode === 'real';
    return rows.map((row) => this.toEntry(row, sameClock));
  }

  private toEntry(row: AuditRow, sameClock: boolean): TimelineEntry {
    return {
      id: row.id,
      seq: row.seq,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      actorId: row.actorId,
      actorName: row.actorName,
      actorRole: row.actorRole,
      deviceId: row.deviceId,
      source: row.source,
      status: statusOf(row.after),
      reasonCode: row.reasonCode,
      reasonNote: row.reasonNote,
      occurredAt: this.clock.toIso(row.occurredAt),
      recordedAt: this.clock.toIso(row.recordedAt),
      syncedLate:
        row.source === 'OFFLINE_SYNC' ||
        (sameClock && syncedLate(row.occurredAt, row.recordedAt)),
    };
  }
}

/** The status a snapshot carries, the one audited field safe to show every reader. */
function statusOf(after: unknown): string | null {
  if (typeof after !== 'object' || after === null) return null;
  const status = (after as Record<string, unknown>).status;
  return typeof status === 'string' ? status : null;
}
