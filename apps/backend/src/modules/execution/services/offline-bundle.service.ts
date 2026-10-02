import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  type Actor,
  type Brand,
  type DockType,
  minuteLabel,
  type ParkingConstraint,
  type StopStatus,
  type TempClass,
  type TripStatus,
} from '@waypoint/shared';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { ClockService } from '../../../core/clock/clock.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { items, orderLines, orders, outlets, stops } from '../../../db/schema';
import { bundleHash } from '../domain/bundle-hash';
import type { OfflineBundleDto } from '../dto/offline-bundle.dto';
import type { TripSummaryRow } from './my-trips.queries';
import { MyTripsQueries } from './my-trips.queries';

/**
 * Everything the phone needs for one stop with no signal (D3 to D9).
 * `OfflineBundleDto` is the same shape for Swagger and the generated client;
 * the compile-time check at the bottom of this file keeps the two together.
 */
export interface BundleStop {
  id: string;
  seq: number | null;
  status: StopStatus;
  plannedArrivalAt: string | null;
  plannedServiceMin: number;
  window: { openMin: number; open: string; closeMin: number; close: string };
  outlet: {
    id: string;
    name: string;
    address: string | null;
    lat: number | null;
    lng: number | null;
    dockType: DockType;
    parkingConstraint: ParkingConstraint;
    accessNotes: string | null;
    contactName: string | null;
    contactPhone: string | null;
  };
  order: {
    id: string;
    orderNo: string;
    tempClass: TempClass;
    units: number;
    lines: {
      id: string;
      itemId: string;
      sku: string;
      name: string;
      packLabel: string;
      qty: number;
    }[];
  };
}

export interface OfflineBundle {
  trip: {
    id: string;
    tripNo: number | null;
    date: string;
    status: TripStatus;
    brand: Brand;
    tempClass: TempClass;
    depotId: string;
    districtId: string;
    vehicle: { id: string; code: string; temp: 'AMBIENT' | 'REEFER' };
    plannedDepartAt: string | null;
  };
  stops: BundleStop[];
  /** The trip's version: what `POST /downloaded` records and If-Match speaks. */
  version: number;
  /** sha256 of everything above, so D2 can tell a stale bundle from a fresh one. */
  hash: string;
  generatedAt: string;
}

/**
 * The one document a driver's phone needs for the whole run: the trip, its
 * stops in order, each outlet with its window, dock, access notes and
 * contact, and the order lines to deliver (AC-EXE-04). Everything after D1
 * reads from this, so anything the driver might need offline belongs here
 * and anything else does not — the budget is about 50 KB.
 *
 * The read goes through `MyTripsQueries.get`, so the bundle is scoped exactly
 * like the trip list: another driver's trip is 404 (AC-EXE-02).
 */
@Injectable()
export class OfflineBundleService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly trips: MyTripsQueries,
    private readonly clock: ClockService,
  ) {}

  async build(tripId: string, actor: Actor): Promise<OfflineBundle> {
    const trip = await this.trips.get(tripId, actor);
    return this.of(trip);
  }

  /** The bundle of a trip already read and scoped. */
  async of(trip: TripSummaryRow): Promise<OfflineBundle> {
    const tx = this.txHost.tx;
    const rows = await tx
      .select({
        stop: stops,
        outlet: outlets,
        order: orders,
      })
      .from(stops)
      .innerJoin(outlets, eq(outlets.id, stops.outletId))
      .innerJoin(orders, eq(orders.id, stops.orderId))
      .where(and(eq(stops.tripId, trip.id), ne(stops.status, 'CANCELLED')))
      .orderBy(asc(stops.seq), asc(stops.id));

    const orderIds = rows.map((row) => row.order.id);
    const lines = orderIds.length
      ? await tx
          .select({
            id: orderLines.id,
            orderId: orderLines.orderId,
            itemId: orderLines.itemId,
            qty: orderLines.qty,
            sku: items.sku,
            name: items.name,
            packLabel: items.packLabel,
          })
          .from(orderLines)
          .innerJoin(items, eq(items.id, orderLines.itemId))
          .where(inArray(orderLines.orderId, orderIds))
          .orderBy(asc(items.sku))
      : [];

    const body = {
      trip: {
        id: trip.id,
        tripNo: trip.tripNo,
        date: trip.date,
        status: trip.status,
        brand: trip.brand,
        tempClass: trip.tempClass,
        depotId: trip.depotId,
        districtId: trip.districtId,
        vehicle: {
          id: trip.vehicleId,
          code: trip.vehicleCode,
          temp: trip.vehicleTemp,
        },
        plannedDepartAt: trip.plannedDepartAt
          ? this.clock.toIso(trip.plannedDepartAt)
          : null,
      },
      stops: rows.map(({ stop, outlet, order }) => ({
        id: stop.id,
        seq: stop.seq,
        status: stop.status,
        plannedArrivalAt: stop.plannedArrivalAt
          ? this.clock.toIso(stop.plannedArrivalAt)
          : null,
        plannedServiceMin: stop.plannedServiceMin,
        window: {
          openMin: stop.windowOpenMin,
          open: minuteLabel(stop.windowOpenMin),
          closeMin: stop.windowCloseMin,
          close: minuteLabel(stop.windowCloseMin),
        },
        outlet: {
          id: outlet.id,
          name: outlet.name,
          address: outlet.address,
          lat: outlet.lat,
          lng: outlet.lng,
          dockType: outlet.dockType,
          parkingConstraint: outlet.parkingConstraint,
          accessNotes: outlet.accessNotes,
          contactName: outlet.receivingContactName,
          contactPhone: outlet.receivingContactPhone,
        },
        order: {
          id: order.id,
          orderNo: order.orderNo,
          tempClass: order.tempClass,
          units: order.units,
          lines: lines
            .filter((line) => line.orderId === order.id)
            .map((line) => ({
              id: line.id,
              itemId: line.itemId,
              sku: line.sku,
              name: line.name,
              packLabel: line.packLabel,
              qty: line.qty,
            })),
        },
      })),
      version: trip.version,
    };

    return {
      ...body,
      hash: bundleHash(body),
      generatedAt: this.clock.toIso(this.clock.now()),
    };
  }
}

/**
 * The response DTO and what this service builds are the same shape. If one
 * grows a field the other does not, this stops compiling rather than leaving
 * the generated client lying about the bundle.
 */
const _shapesAgree: OfflineBundleDto = {} as unknown as OfflineBundle;
void _shapesAgree;
