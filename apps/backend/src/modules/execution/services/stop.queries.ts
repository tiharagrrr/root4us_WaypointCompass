import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Actor, DeliveryOutcome, StopStatus } from '@waypoint/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { outlets, stops, trips } from '../../../db/schema';
import { StopScope } from '../policies/trip.scope';

/** A stop as D3, D4 and D5 read it. */
export interface StopView {
  id: string;
  tripId: string;
  orderId: string;
  outletId: string;
  outletName: string;
  seq: number | null;
  status: StopStatus;
  windowOpenMin: number;
  windowCloseMin: number;
  plannedArrivalAt: Date | null;
  arrivedAt: Date | null;
  completedAt: Date | null;
  outcome: DeliveryOutcome | null;
  receiverName: string | null;
  exceptionNote: string | null;
  unitsDelivered: number | null;
  version: number;
  /** The trip this stop belongs to, for the state checks and the routing. */
  tripStatus: string;
  tripDepotId: string;
  tripDriverId: string | null;
  tripVehicleId: string;
}

/**
 * Reads of stops, always through `StopScope`, which is `TripScope` one join
 * away: a stop is readable exactly when its trip is (AC-EXE-02). The view
 * carries the few trip columns the recording rules need, so a write never
 * has to read the trip separately.
 */
@Injectable()
export class StopQueries {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: StopScope,
  ) {}

  /** One stop in scope, or 404 — the same body as a stop that never existed. */
  async get(id: string, actor: Actor): Promise<StopView> {
    const [row] = await this.select(
      and(eq(stops.id, id), this.scope.where(actor)),
    );
    return this.scope.found(row);
  }

  /** Every live stop of a trip, in planned order. */
  async ofTrip(tripId: string, actor: Actor): Promise<StopView[]> {
    return this.select(and(eq(stops.tripId, tripId), this.scope.where(actor)));
  }

  private async select(where: ReturnType<typeof and>): Promise<StopView[]> {
    return this.txHost.tx
      .select({
        id: stops.id,
        tripId: stops.tripId,
        orderId: stops.orderId,
        outletId: stops.outletId,
        outletName: outlets.name,
        seq: stops.seq,
        status: stops.status,
        windowOpenMin: stops.windowOpenMin,
        windowCloseMin: stops.windowCloseMin,
        plannedArrivalAt: stops.plannedArrivalAt,
        arrivedAt: stops.arrivedAt,
        completedAt: stops.completedAt,
        outcome: stops.outcome,
        receiverName: stops.receiverName,
        exceptionNote: stops.exceptionNote,
        unitsDelivered: stops.unitsDelivered,
        version: stops.version,
        tripStatus: trips.status,
        tripDepotId: trips.depotId,
        tripDriverId: trips.driverId,
        tripVehicleId: trips.vehicleId,
      })
      .from(stops)
      .innerJoin(trips, eq(trips.id, stops.tripId))
      .innerJoin(outlets, eq(outlets.id, stops.outletId))
      .where(where)
      .orderBy(asc(stops.seq), asc(stops.id));
  }
}
