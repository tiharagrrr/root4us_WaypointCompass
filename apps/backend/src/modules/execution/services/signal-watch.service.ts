import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { OnTick } from '../../../core/scheduling/ticker.service';
import { SettingsService } from '../../../core/settings/settings.service';
import {
  outboxEvents,
  stopEvents,
  trips,
  vehiclePositions,
} from '../../../db/schema';
import { AuditService } from '../../audit';
import {
  EXECUTION_AUDIT,
  EXECUTION_EVENTS,
  EXECUTION_LOGS,
  EXECUTION_TICKS,
} from '../execution.constants';

export interface SilentTrip {
  tripId: string;
  vehicleId: string;
  depotId: string;
  lastSignalAt: Date;
}

/**
 * The signal watch (AC-EXE-19): once a minute, every IN_PROGRESS trip whose
 * last ping or stop event is older than tracking.offlineAlertMinutes gets one
 * `vehicle.offline`, which alerts turns into VEHICLE_OFFLINE. It is not
 * repeated while the trip stays silent; the next ping emits
 * `vehicle.back_online` (TelematicsService). The tick's `now` is the demo
 * clock's, so time travel triggers it like a real morning would.
 */
@Injectable()
export class SignalWatchService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(SignalWatchService.name);
  }

  /** `tripIds` narrows the watch (tests); the ticker watches every running trip. */
  @OnTick(EXECUTION_TICKS.signalWatch)
  async watch(now: Date, tripIds?: string[]): Promise<number> {
    let raised = 0;
    for (const trip of await this.lastSignals(tripIds)) {
      const limit = await this.settings.get(
        'tracking.offlineAlertMinutes',
        trip.depotId,
      );
      const silentMin = (now.getTime() - trip.lastSignalAt.getTime()) / 60_000;
      if (silentMin < limit) continue;
      if (await this.raise(trip, silentMin)) raised += 1;
    }
    return raised;
  }

  /** Every running trip with the time of its last ping, stop event or start. */
  async lastSignals(tripIds?: string[]): Promise<SilentTrip[]> {
    const rows = await this.txHost.tx
      .select({
        tripId: trips.id,
        vehicleId: trips.vehicleId,
        depotId: trips.depotId,
        startedAt: trips.startedAt,
        pingAt:
          sql<Date | null>`(SELECT ${vehiclePositions.recordedAt} FROM ${vehiclePositions} WHERE ${vehiclePositions.vehicleId} = ${trips.vehicleId} AND ${vehiclePositions.tripId} = ${trips.id})`.mapWith(
            (v: string | Date | null) => (v ? new Date(v) : null),
          ),
        eventAt:
          sql<Date | null>`(SELECT max(${stopEvents.occurredAt}) FROM ${stopEvents} WHERE ${stopEvents.tripId} = ${trips.id})`.mapWith(
            (v: string | Date | null) => (v ? new Date(v) : null),
          ),
      })
      .from(trips)
      .where(
        and(
          eq(trips.status, 'IN_PROGRESS'),
          tripIds ? inArray(trips.id, tripIds) : undefined,
        ),
      );
    return rows.flatMap((r) => {
      const times = [r.startedAt, r.pingAt, r.eventAt].filter(
        (t): t is Date => t instanceof Date,
      );
      if (!times.length) return [];
      return [
        {
          tripId: r.tripId,
          vehicleId: r.vehicleId,
          depotId: r.depotId,
          lastSignalAt: new Date(Math.max(...times.map((t) => t.getTime()))),
        },
      ];
    });
  }

  @Transactional()
  private async raise(trip: SilentTrip, silentMin: number): Promise<boolean> {
    const [last] = await this.txHost.tx
      .select({ type: outboxEvents.type, occurredAt: outboxEvents.occurredAt })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.aggregateType, 'trip'),
          eq(outboxEvents.aggregateId, trip.tripId),
          inArray(outboxEvents.type, [
            EXECUTION_EVENTS.vehicleOffline,
            EXECUTION_EVENTS.vehicleBackOnline,
          ]),
        ),
      )
      .orderBy(desc(outboxEvents.occurredAt), desc(outboxEvents.id))
      .limit(1);
    // Already announced for this silence.
    if (last?.type === EXECUTION_EVENTS.vehicleOffline) return false;
    const minutesSilent = Math.floor(silentMin);
    await this.audit.record({
      action: EXECUTION_AUDIT.vehicleOffline,
      entity: ['trip', trip.tripId],
      after: { vehicleId: trip.vehicleId, minutesSilent },
      source: 'SYSTEM',
    });
    await this.outbox.add(
      EXECUTION_EVENTS.vehicleOffline,
      { v: 1, tripId: trip.tripId, vehicleRef: trip.vehicleId, minutesSilent },
      { aggregate: ['trip', trip.tripId], depotId: trip.depotId },
    );
    this.log.info(
      {
        event: EXECUTION_LOGS.vehicleOffline,
        tripId: trip.tripId,
        vehicleId: trip.vehicleId,
        minutesSilent,
      },
      'vehicle offline',
    );
    return true;
  }
}
