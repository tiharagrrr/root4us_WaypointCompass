import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { CantRunReason, DeliveryOutcome } from '@waypoint/shared';
import { and, eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import {
  NotFoundError,
  VersionMismatchError,
} from '../../../core/errors/domain-errors';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { stops, trips } from '../../../db/schema';
import { AuditService } from '../../audit';
import { nextStopStatus, nextTripStatus } from '../domain/transitions';
import { PLANNING_AUDIT } from '../planning.constants';

export type TripRow = typeof trips.$inferSelect;
export type StopRow = typeof stops.$inferSelect;

/** What a trip's audit row keeps: the fields a reviewer reads, not the whole row. */
const tripShape = (t: TripRow) => ({
  status: t.status,
  vehicleId: t.vehicleId,
  driverId: t.driverId,
  downloadedAt: t.downloadedAt,
  startedAt: t.startedAt,
  completedAt: t.completedAt,
  cantRunReason: t.cantRunReason,
  version: t.version,
});

const stopShape = (s: StopRow) => ({
  status: s.status,
  seq: s.seq,
  arrivedAt: s.arrivedAt,
  completedAt: s.completedAt,
  outcome: s.outcome,
  unitsDelivered: s.unitsDelivered,
  version: s.version,
});

/**
 * The one way a trip's or a stop's status moves (architecture rule 2).
 * Loading and execution call these methods inside their own transaction, so
 * the status change, its audit row and the caller's own write all commit
 * together; the caller emits its own domain event (`trip.started`,
 * `stop.completed`, ...), because the move is part of that use case rather
 * than one of its own (AC-PLN-34).
 *
 * Every method checks `tripMachine` or `stopMachine` first, so a move the
 * machine refuses throws before anything is written and the caller's
 * transaction rolls back. `@Transactional()` joins the caller's transaction
 * rather than opening one of its own.
 *
 * What is here is what the dock (`markLoading`, `markReleased`,
 * `markReloading`) and the driver's events need. `cancel`, reassign and
 * resequence are planning's own use cases and land with the planning API
 * (specs/planning/spec.md, Services).
 */
@Injectable()
export class TripLifecycleService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(TripLifecycleService.name);
  }

  /**
   * The dock started loading this trip (AC-LOD-04): PLANNED → LOADING, on
   * the first line a loader checks. Loading calls it inside its own
   * transaction, so the check and the status move commit together.
   */
  @Transactional()
  async markLoading(id: string): Promise<TripRow> {
    return this.moveTrip(id, 'START_LOADING', {});
  }

  /**
   * The dock released the trip (AC-LOD-16): LOADING → RELEASED. The release
   * columns live on the trip; the typed Checked-by name and the release's
   * `clientUuid` stay with loading, which owns that record.
   */
  @Transactional()
  async markReleased(
    id: string,
    input: {
      at: Date;
      releasedById?: string | null;
      reeferTempC?: number | null;
    },
  ): Promise<TripRow> {
    return this.moveTrip(id, 'RELEASE', {
      releasedAt: input.at,
      releasedById: input.releasedById ?? null,
      ...(input.reeferTempC != null && { releaseTempC: input.reeferTempC }),
    });
  }

  /**
   * A released trip moved to another vehicle has to be loaded again
   * (AC-LOD-19): RELEASED → LOADING, clearing the release columns so the
   * trip does not look released while it is being re-picked. The move itself
   * belongs to reassign; until that endpoint lands, loading asks for it when
   * `trip.reassigned` reaches LoadListBuilder for a RELEASED trip.
   */
  @Transactional()
  async markReloading(id: string): Promise<TripRow> {
    return this.moveTrip(id, 'REASSIGN_VEHICLE', {
      releasedAt: null,
      releasedById: null,
      releaseTempC: null,
    });
  }

  /**
   * The driver's phone saved the bundle for offline use (AC-EXE-04). No
   * status moves: a RELEASED trip that has been downloaded is still RELEASED,
   * and a re-download after a revision is allowed and expected.
   */
  @Transactional()
  async markDownloaded(
    id: string,
    input: { at: Date; bundleVersion: number },
  ): Promise<TripRow> {
    return this.writeTrip(
      id,
      { downloadedAt: input.at },
      { bundleVersion: input.bundleVersion },
    );
  }

  /** The driver started the trip (AC-EXE-06): RELEASED → IN_PROGRESS. */
  @Transactional()
  async markStarted(
    id: string,
    input: { at: Date; reeferTempC?: number | null },
  ): Promise<TripRow> {
    return this.moveTrip(id, 'START', {
      startedAt: input.at,
      ...(input.reeferTempC != null && { releaseTempC: input.reeferTempC }),
    });
  }

  /** The driver finished the trip (AC-EXE-15): IN_PROGRESS → COMPLETED. */
  @Transactional()
  async markCompleted(id: string, input: { at: Date }): Promise<TripRow> {
    return this.moveTrip(id, 'COMPLETE', { completedAt: input.at });
  }

  /**
   * The driver cannot run this trip (AC-EXE-14). The status stays where it
   * was — `tripMachine` has no CANT_RUN event, and the trip keeps its vehicle
   * and driver until a dispatcher reassigns it — so this records the reason
   * and leaves the decision to 20.
   */
  @Transactional()
  async markCantRun(
    id: string,
    input: { reason: CantRunReason },
  ): Promise<TripRow> {
    return this.writeTrip(
      id,
      { cantRunReason: input.reason },
      { reason: input.reason },
    );
  }

  /** The driver reached the outlet (AC-EXE-08): PENDING → ARRIVED. */
  @Transactional()
  async markArrived(
    stopId: string,
    input: { at: Date; lat?: number | null; lng?: number | null },
  ): Promise<StopRow> {
    return this.moveStop(stopId, 'ARRIVE', {
      arrivedAt: input.at,
      arrivedLat: input.lat ?? null,
      arrivedLng: input.lng ?? null,
    });
  }

  /**
   * The stop's result (AC-EXE-09, AC-EXE-11, AC-EXE-12): ARRIVED → DELIVERED,
   * PARTIAL or FAILED. A stop that already carries an outcome is refused by
   * the machine, which is what makes a recorded outcome final (AC-EXE-13).
   */
  @Transactional()
  async markStopOutcome(
    stopId: string,
    input: {
      outcome: DeliveryOutcome;
      at: Date;
      receiverName?: string | null;
      note?: string | null;
      unitsDelivered?: number | null;
    },
  ): Promise<StopRow> {
    const event =
      input.outcome === 'DELIVERED'
        ? 'DELIVER'
        : input.outcome === 'PARTIAL'
          ? 'PARTIAL'
          : 'FAIL';
    return this.moveStop(stopId, event, {
      completedAt: input.at,
      outcome: input.outcome,
      receiverName: input.receiverName ?? null,
      exceptionNote: input.note ?? null,
      unitsDelivered: input.unitsDelivered ?? null,
    });
  }

  private async moveTrip(
    id: string,
    event:
      'START_LOADING' | 'RELEASE' | 'START' | 'COMPLETE' | 'REASSIGN_VEHICLE',
    changes: Partial<typeof trips.$inferInsert>,
  ): Promise<TripRow> {
    const before = await this.loadTrip(id);
    const status = nextTripStatus(before.status, event);
    return this.saveTrip(before, { ...changes, status }, { event, status });
  }

  /** A column change with no status move: the machine has nothing to say. */
  private async writeTrip(
    id: string,
    changes: Partial<typeof trips.$inferInsert>,
    logged: Record<string, unknown>,
  ): Promise<TripRow> {
    return this.saveTrip(await this.loadTrip(id), changes, logged);
  }

  private async saveTrip(
    before: TripRow,
    changes: Partial<typeof trips.$inferInsert>,
    logged: Record<string, unknown>,
  ): Promise<TripRow> {
    const [row] = await this.txHost.tx
      .update(trips)
      .set({
        ...changes,
        version: before.version + 1,
        updatedAt: this.clock.realNow(),
      })
      .where(and(eq(trips.id, before.id), eq(trips.version, before.version)))
      .returning();
    if (!row) throw new VersionMismatchError('trip');
    await this.audit.record({
      action: PLANNING_AUDIT.tripStatusChanged,
      entity: ['trip', before.id],
      before: tripShape(before),
      after: tripShape(row),
    });
    this.log.info(
      { event: PLANNING_AUDIT.tripStatusChanged, tripId: before.id, ...logged },
      'trip moved',
    );
    return row;
  }

  private async moveStop(
    stopId: string,
    event: 'ARRIVE' | 'DELIVER' | 'PARTIAL' | 'FAIL',
    changes: Partial<typeof stops.$inferInsert>,
  ): Promise<StopRow> {
    const before = await this.loadStop(stopId);
    const status = nextStopStatus(before.status, event);
    const [row] = await this.txHost.tx
      .update(stops)
      .set({
        ...changes,
        status,
        version: before.version + 1,
        updatedAt: this.clock.realNow(),
      })
      .where(and(eq(stops.id, stopId), eq(stops.version, before.version)))
      .returning();
    if (!row) throw new VersionMismatchError('stop');
    await this.audit.record({
      action: PLANNING_AUDIT.stopStatusChanged,
      entity: ['stop', stopId],
      before: stopShape(before),
      after: stopShape(row),
    });
    this.log.info(
      {
        event: PLANNING_AUDIT.stopStatusChanged,
        tripId: before.tripId,
        stopId,
        status,
      },
      'stop moved',
    );
    return row;
  }

  private async loadTrip(id: string): Promise<TripRow> {
    const [row] = await this.txHost.tx
      .select()
      .from(trips)
      .where(eq(trips.id, id));
    if (!row) throw new NotFoundError('trip');
    return row;
  }

  private async loadStop(id: string): Promise<StopRow> {
    const [row] = await this.txHost.tx
      .select()
      .from(stops)
      .where(eq(stops.id, id));
    if (!row) throw new NotFoundError('stop');
    return row;
  }
}
