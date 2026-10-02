import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import { SettingsService } from '../../../core/settings/settings.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { alertEventReceipts } from '../../../db/schema';
import { ALERT_LOGS } from '../alerts.constants';
import { AlertRules, type DomainEvent } from '../domain/alert-rules';
import { AlertsService } from './alerts.service';

/** What one delivered event did, for the relay's log and for tests. */
export interface HandledEvent {
  /** Dedupe keys of the alerts this event raised for the first time. */
  raised: string[];
  /** Dedupe keys of the alerts it refreshed without re-announcing. */
  refreshed: string[];
  /** Dedupe keys of the alerts it closed. */
  resolved: string[];
  /** True when the receipts table had already seen this event id. */
  replayed: boolean;
}

const NOTHING: HandledEvent = {
  raised: [],
  refreshed: [],
  resolved: [],
  replayed: false,
};

/**
 * The one way an event becomes an alert.
 *
 * `handle` takes a single outbox row and does everything that row implies, in
 * one transaction: the receipt that marks it handled, the alerts it raises,
 * the alerts it closes, and their audit rows and outbox events. Either all of
 * it lands or none of it does.
 *
 * **How it is driven.** The outbox relay (ROO-24) is not built yet, so
 * nothing calls this in production today. It is exported from the module's
 * index.ts for the relay to call once it lands, one row at a time, which is
 * also exactly how the tests drive it. There is deliberately no event
 * emitter, queue or subscription of its own here: the relay owns delivery,
 * and alerts owns what a delivered event means.
 *
 * **Why the receipts table.** Delivery is at least once. A replay that
 * arrives while the alert is still open is harmless — the dedupe key's
 * partial unique index collapses it into a refresh. A replay that arrives
 * *after* the alert resolved is the problem: the key is free again, so it
 * looks exactly like a genuine new episode, which for VEHICLE_OFFLINE it
 * might well be (AC-ALR-10). Only the event id can tell the two apart, so it
 * is recorded, in the same transaction as the work it covers.
 */
@Injectable()
export class AlertEventListener {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly alerts: AlertsService,
    private readonly clock: ClockService,
    private readonly settings: SettingsService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(AlertEventListener.name);
  }

  @Transactional()
  async handle(event: DomainEvent): Promise<HandledEvent> {
    if (!AlertRules.consumes(event.type)) return NOTHING;
    if (!(await this.claim(event))) {
      this.log.debug(
        {
          event: ALERT_LOGS.eventReplayed,
          eventId: event.id,
          type: event.type,
        },
        'event already handled',
      );
      return { ...NOTHING, replayed: true };
    }

    const { intents, unreadable } = AlertRules.forEvent(event, {
      now: this.clock.now(),
      lateRiskThreshold: await this.settings.get(
        'tracking.lateRiskThreshold',
        event.depotId,
      ),
    });
    if (unreadable) {
      // The receipt stays: retrying a payload that does not parse would only
      // block the events behind it. The log line is the thing to act on.
      this.log.warn(
        {
          event: ALERT_LOGS.eventUnreadable,
          eventId: event.id,
          type: event.type,
          reason: unreadable,
        },
        'event payload did not match its schema',
      );
      return NOTHING;
    }

    const done: HandledEvent = {
      raised: [],
      refreshed: [],
      resolved: [],
      replayed: false,
    };
    for (const intent of intents) {
      if (intent.kind === 'resolve') {
        const closed = await this.alerts.autoResolve(intent.dedupeKey);
        if (closed) done.resolved.push(intent.dedupeKey);
        continue;
      }
      // An alert is scoped to a depot and the outbox row's routing is where
      // every producer already puts one. Without it there is no list the
      // alert could appear on, so say so rather than invent a depot.
      if (!event.depotId) {
        this.log.warn(
          {
            event: ALERT_LOGS.eventUnreadable,
            eventId: event.id,
            type: event.type,
            reason: 'no depotId on the outbox row',
          },
          'cannot raise a depot-scoped alert for an unrouted event',
        );
        continue;
      }
      const { raised } = await this.alerts.raise(intent, event.depotId);
      (raised ? done.raised : done.refreshed).push(intent.dedupeKey);
    }
    return done;
  }

  /**
   * Records that this event id is being handled, or false when it already
   * was. The insert is the lock: a second delivery of the same row conflicts
   * and comes back empty, whichever worker is holding it.
   */
  private async claim(event: DomainEvent): Promise<boolean> {
    const [receipt] = await this.txHost.tx
      .insert(alertEventReceipts)
      .values({ eventId: event.id, type: event.type })
      .onConflictDoNothing()
      .returning({ eventId: alertEventReceipts.eventId });
    return Boolean(receipt);
  }
}
