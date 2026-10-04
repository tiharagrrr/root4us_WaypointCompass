import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import { PayloadTooLargeError } from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import {
  outboxEvents,
  positionPings,
  trips,
  vehiclePositions,
  vehicles,
} from '../../../db/schema';
import { AuditService } from '../../audit';
import {
  keepInTrail,
  MAX_PINGS,
  type PingFix,
  type RejectReason,
  rejectReason,
} from '../domain/pings';
import {
  EXECUTION_AUDIT,
  EXECUTION_EVENTS,
  EXECUTION_LOGS,
} from '../execution.constants';
import { type PositionUpdate, PositionPublisher } from './position-publisher';

export interface PingInput {
  tripId: string;
  lat: number;
  lng: number;
  accuracyM?: number | null;
  speedKmh?: number | null;
  heading?: number | null;
  reeferTempC?: number | null;
  recordedAt: string;
}

/** Who sent the batch: a driver's phone, or the demo position simulator. */
export type PingSender =
  { kind: 'driver'; actor: Actor } | { kind: 'simulator' };

export interface PingResult {
  accepted: number;
  duplicates: number;
  rejected: number;
  /** Why each refused ping was refused, in batch order; for the client's log, never shown. */
  reasons: { index: number; reason: RejectReason }[];
}

/** A ping with its time parsed. */
type Fix = Omit<PingInput, 'recordedAt'> & { recordedAt: Date };

type TripRow = {
  id: string;
  vehicleId: string;
  vehicleCode: string;
  driverId: string | null;
  status: string;
  depotId: string;
};

/**
 * The ping pipeline (specs/execution/spec.md): validate, dedupe on
 * (vehicleId, recordedAt), keep the latest position, sample the trail, then
 * after the commit send each vehicle's newest position to the screens. A ping
 * after a vehicle went offline brings it back online (AC-EXE-19).
 */
@Injectable()
export class TelematicsService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly publisher: PositionPublisher,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(TelematicsService.name);
  }

  /** The whole pipeline; positions go out only once the rows are committed. */
  async receive(pings: PingInput[], sender: PingSender): Promise<PingResult> {
    if (pings.length > MAX_PINGS) throw new PayloadTooLargeError();
    const { result, latest } = await this.ingest(pings, sender);
    for (const update of latest)
      await this.publisher.publish(update).catch((err: unknown) =>
        this.log.warn(
          {
            event: EXECUTION_LOGS.positionNotPublished,
            vehicleId: update.vehicleId,
            err,
          },
          'could not publish a position',
        ),
      );
    return result;
  }

  @Transactional()
  async ingest(
    pings: PingInput[],
    sender: PingSender,
  ): Promise<{ result: PingResult; latest: PositionUpdate[] }> {
    const tx = this.txHost.tx;
    const now = this.clock.now();
    const result: PingResult = {
      accepted: 0,
      duplicates: 0,
      rejected: 0,
      reasons: [],
    };
    const tripIds = [...new Set(pings.map((p) => p.tripId).filter(Boolean))];
    const tripRows: TripRow[] = tripIds.length
      ? await tx
          .select({
            id: trips.id,
            vehicleId: trips.vehicleId,
            vehicleCode: vehicles.code,
            driverId: trips.driverId,
            status: trips.status,
            depotId: trips.depotId,
          })
          .from(trips)
          .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
          .where(inArray(trips.id, tripIds))
      : [];
    const tripsById = new Map(tripRows.map((t) => [t.id, t]));

    // Validate: a ping counts only for a running trip the sender drives (or the simulator).
    const valid: { trip: TripRow; fix: Fix }[] = [];
    pings.forEach((ping, index) => {
      const trip = tripsById.get(ping.tripId);
      const fix: Fix = { ...ping, recordedAt: new Date(ping.recordedAt) };
      const mine =
        trip &&
        trip.status === 'IN_PROGRESS' &&
        (sender.kind === 'simulator' || trip.driverId === sender.actor.id);
      const reason: RejectReason | null = !mine
        ? 'not_your_running_trip'
        : Number.isNaN(fix.recordedAt.getTime())
          ? 'too_old'
          : rejectReason(fix, now);
      if (reason) {
        result.rejected += 1;
        result.reasons.push({ index, reason });
      } else if (trip) valid.push({ trip, fix });
    });

    const latest: PositionUpdate[] = [];
    const byVehicle = new Map<string, typeof valid>();
    for (const v of valid)
      byVehicle.set(v.trip.vehicleId, [
        ...(byVehicle.get(v.trip.vehicleId) ?? []),
        v,
      ]);

    for (const [vehicleId, batch] of byVehicle) {
      batch.sort(
        (a, b) => a.fix.recordedAt.getTime() - b.fix.recordedAt.getTime(),
      );
      // Dedupe on (vehicleId, recordedAt): what the trail already holds, and repeats in the batch.
      const stored = await tx
        .select({ recordedAt: positionPings.recordedAt })
        .from(positionPings)
        .where(
          and(
            eq(positionPings.vehicleId, vehicleId),
            inArray(
              positionPings.recordedAt,
              batch.map((b) => b.fix.recordedAt),
            ),
          ),
        );
      const seen = new Set(stored.map((s) => s.recordedAt.getTime()));
      const fresh = batch.filter((b) => {
        const at = b.fix.recordedAt.getTime();
        if (seen.has(at)) {
          result.duplicates += 1;
          return false;
        }
        seen.add(at);
        return true;
      });
      if (!fresh.length) continue;
      result.accepted += fresh.length;

      // The trail: a ping every 30 seconds or 100 m.
      const [lastKept] = await tx
        .select({
          lat: positionPings.lat,
          lng: positionPings.lng,
          recordedAt: positionPings.recordedAt,
        })
        .from(positionPings)
        .where(eq(positionPings.vehicleId, vehicleId))
        .orderBy(desc(positionPings.recordedAt))
        .limit(1);
      let last: PingFix | null = lastKept ?? null;
      const kept: (typeof positionPings.$inferInsert)[] = [];
      for (const { trip, fix } of fresh) {
        if (!keepInTrail(last, fix)) continue;
        last = fix;
        kept.push({
          vehicleId,
          tripId: trip.id,
          deviceId: sender.kind === 'driver' ? sender.actor.deviceId : null,
          lat: fix.lat,
          lng: fix.lng,
          speedKmh: fix.speedKmh ?? null,
          heading: fix.heading ?? null,
          accuracyM: fix.accuracyM ?? null,
          reeferTempC: fix.reeferTempC ?? null,
          source: sender.kind === 'simulator' ? 'simulator' : 'pwa',
          recordedAt: fix.recordedAt,
          receivedAt: this.clock.realNow(),
        });
      }
      if (kept.length)
        await tx.insert(positionPings).values(kept).onConflictDoNothing();

      // The latest position only ever moves forward.
      const newest = fresh[fresh.length - 1];
      const [before] = await tx
        .select({ recordedAt: vehiclePositions.recordedAt })
        .from(vehiclePositions)
        .where(eq(vehiclePositions.vehicleId, vehicleId));
      if (before && before.recordedAt >= newest.fix.recordedAt) continue;
      const row = {
        vehicleId,
        tripId: newest.trip.id,
        lat: newest.fix.lat,
        lng: newest.fix.lng,
        speedKmh: newest.fix.speedKmh ?? null,
        heading: newest.fix.heading ?? null,
        accuracyM: newest.fix.accuracyM ?? null,
        reeferTempC: newest.fix.reeferTempC ?? null,
        source: sender.kind === 'simulator' ? 'simulator' : 'pwa',
        recordedAt: newest.fix.recordedAt,
        receivedAt: this.clock.realNow(),
      };
      await tx
        .insert(vehiclePositions)
        .values(row)
        .onConflictDoUpdate({
          target: vehiclePositions.vehicleId,
          set: row,
          setWhere: sql`${vehiclePositions.recordedAt} < excluded."recordedAt"`,
        });
      await this.backOnline(newest.trip);
      latest.push({
        vehicleId,
        vehicleCode: newest.trip.vehicleCode,
        tripId: newest.trip.id,
        depotId: newest.trip.depotId,
        lat: newest.fix.lat,
        lng: newest.fix.lng,
        heading: newest.fix.heading ?? null,
        speedKmh: newest.fix.speedKmh ?? null,
        recordedAt: newest.fix.recordedAt,
      });
    }
    return { result, latest };
  }

  /** The first ping after vehicle.offline emits vehicle.back_online, once. */
  private async backOnline(trip: TripRow): Promise<void> {
    const [last] = await this.txHost.tx
      .select({ type: outboxEvents.type })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.aggregateType, 'trip'),
          eq(outboxEvents.aggregateId, trip.id),
          inArray(outboxEvents.type, [
            EXECUTION_EVENTS.vehicleOffline,
            EXECUTION_EVENTS.vehicleBackOnline,
          ]),
        ),
      )
      .orderBy(desc(outboxEvents.occurredAt), desc(outboxEvents.id))
      .limit(1);
    if (last?.type !== EXECUTION_EVENTS.vehicleOffline) return;
    await this.audit.record({
      action: EXECUTION_AUDIT.vehicleBackOnline,
      entity: ['trip', trip.id],
      after: { vehicleId: trip.vehicleId },
      source: 'SYSTEM',
    });
    await this.outbox.add(
      EXECUTION_EVENTS.vehicleBackOnline,
      { v: 1, tripId: trip.id, vehicleRef: trip.vehicleId },
      { aggregate: ['trip', trip.id], depotId: trip.depotId },
    );
    this.log.info(
      {
        event: EXECUTION_LOGS.vehicleBackOnline,
        tripId: trip.id,
        vehicleId: trip.vehicleId,
      },
      'vehicle back online',
    );
  }
}
