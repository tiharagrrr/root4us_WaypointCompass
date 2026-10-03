import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { isoWeekOf } from '@waypoint/shared';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { fuelLedgerEntries, trips, vehicles } from '../../../db/schema';
import { NotFoundError } from '../../../core/errors/domain-errors';

export interface IsoWeek {
  isoYear: number;
  isoWeek: number;
}

/** A published trip's planned fuel, as the engine measured it. */
export interface PlannedFuel {
  tripId: string;
  vehicleId: string;
  /** The plan's business date, which fixes the ISO week. */
  date: string;
  km: number;
  litres: number;
}

/** One vehicle's week: what A5 and GET /vehicles/{id}/fuel show. */
export interface FuelWeek extends IsoWeek {
  vehicleId: string;
  quotaL: number;
  /** Net PLANNED litres: reversals are negative PLANNED entries. */
  plannedL: number;
  actualL: number;
  adjustmentL: number;
  /** Every entry of the week; what counts against the quota. */
  usedL: number;
  leftL: number;
}

/**
 * The weekly fuel ledger (specs/fleet/spec.md). Entries are never edited: a
 * correction is a new entry, and a reversal is a PLANNED entry with negative
 * litres, so "planned" is always the net of what is still planned.
 *
 * Used is the sum of every entry in the week. Closing the day therefore
 * reverses a trip's PLANNED fuel when it records the ACTUAL, so a trip never
 * counts twice.
 *
 * Planning calls the writes inside its own transaction (publish, revise,
 * close), which writes the audit row and the event; `@Transactional()` joins
 * it. The litres come from the engine, which owns km and litres per trip, so
 * the formula is never repeated here.
 */
@Injectable()
export class FuelLedgerService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
  ) {}

  /** One PLANNED entry per trip, in the ISO week of the plan's date. */
  @Transactional()
  async addPlanned(entries: readonly PlannedFuel[]): Promise<void> {
    if (entries.length === 0) return;
    await this.txHost.tx.insert(fuelLedgerEntries).values(
      entries.map((e) => ({
        vehicleId: e.vehicleId,
        tripId: e.tripId,
        ...isoWeekOf(e.date),
        date: e.date,
        kind: 'PLANNED' as const,
        km: e.km,
        litres: e.litres,
      })),
    );
  }

  /**
   * Takes back what is still planned for these trips: one negative PLANNED
   * entry per trip, in the week of its original entries. A trip with nothing
   * left planned gets no entry, so reversing twice is harmless.
   */
  @Transactional()
  async reversePlanned(
    tripIds: readonly string[],
    note?: string,
  ): Promise<void> {
    if (tripIds.length === 0) return;
    const open = await this.txHost.tx
      .select({
        tripId: fuelLedgerEntries.tripId,
        vehicleId: fuelLedgerEntries.vehicleId,
        isoYear: fuelLedgerEntries.isoYear,
        isoWeek: fuelLedgerEntries.isoWeek,
        date: fuelLedgerEntries.date,
        km: sql<number>`sum(${fuelLedgerEntries.km})::float8`,
        litres: sql<number>`sum(${fuelLedgerEntries.litres})::float8`,
      })
      .from(fuelLedgerEntries)
      .where(
        and(
          inArray(fuelLedgerEntries.tripId, [...tripIds]),
          eq(fuelLedgerEntries.kind, 'PLANNED'),
        ),
      )
      .groupBy(
        fuelLedgerEntries.tripId,
        fuelLedgerEntries.vehicleId,
        fuelLedgerEntries.isoYear,
        fuelLedgerEntries.isoWeek,
        fuelLedgerEntries.date,
      );
    const reversals = open.filter((o) => o.litres !== 0 || o.km !== 0);
    if (reversals.length === 0) return;
    await this.txHost.tx.insert(fuelLedgerEntries).values(
      reversals.map((o) => ({
        ...o,
        kind: 'PLANNED' as const,
        km: -o.km,
        litres: -o.litres,
        note: note ?? 'reversal',
      })),
    );
  }

  /**
   * Litres already used this ISO week per vehicle, for the engine's
   * `fuelUsedThisWeek`. `excludePlanId` leaves out the entries of the plan
   * being built, so a plan never counts its own fuel twice.
   */
  async usedThisWeek(
    vehicleIds: readonly string[],
    date: string,
    { excludePlanId }: { excludePlanId?: string } = {},
  ): Promise<Map<string, number>> {
    const used = new Map(vehicleIds.map((id) => [id, 0]));
    if (vehicleIds.length === 0) return used;
    const { isoYear, isoWeek } = isoWeekOf(date);
    const rows = await this.txHost.tx
      .select({
        vehicleId: fuelLedgerEntries.vehicleId,
        litres: sql<number>`sum(${fuelLedgerEntries.litres})::float8`,
      })
      .from(fuelLedgerEntries)
      .leftJoin(trips, eq(trips.id, fuelLedgerEntries.tripId))
      .where(
        and(
          inArray(fuelLedgerEntries.vehicleId, [...vehicleIds]),
          eq(fuelLedgerEntries.isoYear, isoYear),
          eq(fuelLedgerEntries.isoWeek, isoWeek),
          excludePlanId
            ? or(isNull(trips.planId), ne(trips.planId, excludePlanId))
            : undefined,
        ),
      )
      .groupBy(fuelLedgerEntries.vehicleId);
    for (const row of rows) used.set(row.vehicleId, row.litres);
    return used;
  }

  /** A vehicle's quota, planned, actual and left for one ISO week. */
  async weekOf(vehicleId: string, week: IsoWeek): Promise<FuelWeek> {
    const [vehicle] = await this.txHost.tx
      .select({ quotaL: vehicles.weeklyFuelQuotaL })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId));
    if (!vehicle) throw new NotFoundError('vehicle');
    const rows = await this.txHost.tx
      .select({
        kind: fuelLedgerEntries.kind,
        litres: sql<number>`sum(${fuelLedgerEntries.litres})::float8`,
      })
      .from(fuelLedgerEntries)
      .where(
        and(
          eq(fuelLedgerEntries.vehicleId, vehicleId),
          eq(fuelLedgerEntries.isoYear, week.isoYear),
          eq(fuelLedgerEntries.isoWeek, week.isoWeek),
        ),
      )
      .groupBy(fuelLedgerEntries.kind);
    const of = (kind: string) => rows.find((r) => r.kind === kind)?.litres ?? 0;
    const plannedL = of('PLANNED');
    const actualL = of('ACTUAL');
    const adjustmentL = of('ADJUSTMENT');
    const usedL = plannedL + actualL + adjustmentL;
    return {
      vehicleId,
      ...week,
      quotaL: vehicle.quotaL,
      plannedL,
      actualL,
      adjustmentL,
      usedL,
      leftL: vehicle.quotaL - usedL,
    };
  }
}
