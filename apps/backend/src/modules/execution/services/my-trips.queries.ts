import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type {
  Actor,
  Brand,
  CantRunReason,
  TempClass,
  TripStatus,
} from '@waypoint/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { plans, stops, trips, vehicles } from '../../../db/schema';
import { TripScope } from '../policies/trip.scope';

/** A trip as D1, D10, D14 and the field endpoints read it. */
export interface TripSummaryRow {
  id: string;
  tripNo: number | null;
  status: TripStatus;
  /** The plan's business date, which is the trip's day. */
  date: string;
  depotId: string;
  districtId: string;
  brand: Brand;
  tempClass: TempClass;
  vehicleId: string;
  vehicleCode: string;
  vehicleTemp: 'AMBIENT' | 'REEFER';
  driverId: string | null;
  plannedDepartAt: Date | null;
  releasedAt: Date | null;
  downloadedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cantRunReason: CantRunReason | null;
  /** Stops still on the trip; a cancelled stop is not one of them. */
  stops: number;
  /** Stops with nothing recorded yet, which is what blocks a trip's end. */
  openStops: number;
  version: number;
}

/**
 * D1 lists the trips the driver has today, D10 the last 7 days and D14 says
 * "no trip" when the list is empty. Every read goes through `TripScope`
 * (architecture rule 5), so a driver's list is her own by construction
 * rather than by a filter the caller could leave off (AC-EXE-01, AC-EXE-02).
 *
 * The statuses listed start at RELEASED: a trip still being planned or
 * loaded is the depot's business, not the driver's. The scope stays wider
 * than the list on purpose, so starting a LOADING trip answers 409 rather
 * than 404 (AC-EXE-07).
 */
const LISTED: TripStatus[] = [
  'RELEASED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
];

@Injectable()
export class MyTripsQueries {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: TripScope,
  ) {}

  /** The actor's trips for one business date, or for the whole window. */
  async list(actor: Actor, date?: string): Promise<TripSummaryRow[]> {
    return this.select(
      and(
        this.scope.where(actor),
        date ? eq(plans.date, date) : undefined,
        inArray(trips.status, LISTED),
      ),
    );
  }

  /** One trip in scope, or 404 — the same body as a trip that never existed. */
  async get(id: string, actor: Actor): Promise<TripSummaryRow> {
    const [row] = await this.select(
      and(eq(trips.id, id), this.scope.where(actor)),
    );
    return this.scope.found(row);
  }

  private async select(where: ReturnType<typeof and>) {
    return this.txHost.tx
      .select({
        id: trips.id,
        tripNo: trips.tripNo,
        status: trips.status,
        date: plans.date,
        depotId: trips.depotId,
        districtId: trips.districtId,
        brand: trips.brand,
        tempClass: trips.tempClass,
        vehicleId: trips.vehicleId,
        vehicleCode: vehicles.code,
        vehicleTemp: vehicles.temp,
        driverId: trips.driverId,
        plannedDepartAt: trips.plannedDepartAt,
        releasedAt: trips.releasedAt,
        downloadedAt: trips.downloadedAt,
        startedAt: trips.startedAt,
        completedAt: trips.completedAt,
        cantRunReason: trips.cantRunReason,
        stops:
          sql<number>`(SELECT count(*) FROM ${stops} WHERE ${stops.tripId} = ${trips.id} AND ${stops.status} <> 'CANCELLED')`.mapWith(
            Number,
          ),
        openStops:
          sql<number>`(SELECT count(*) FROM ${stops} WHERE ${stops.tripId} = ${trips.id} AND ${stops.status} IN ('PENDING', 'ARRIVED'))`.mapWith(
            Number,
          ),
        version: trips.version,
      })
      .from(trips)
      .innerJoin(plans, eq(plans.id, trips.planId))
      .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
      .where(where)
      .orderBy(asc(plans.date), asc(trips.tripNo), asc(trips.id));
  }
}
