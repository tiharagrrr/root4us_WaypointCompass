/**
 * Seeds master data from the shared challenge datasets in data/seed/*.csv.
 * Idempotent: every table is upserted, so it runs on each `docker compose up`.
 *   dev:    pnpm db:seed
 *   docker: node dist/database/seed.js (run by the `seed` service)
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type {
  Brand,
  DockType,
  ParkingConstraint,
  VehicleTemp,
  VehicleType,
} from '@waypoint/shared';
import { createDatabase, createPool, type Database } from './client';
import { loadEnv, REPO_ROOT, requireEnv } from './env';
import {
  calendarDays,
  depots,
  districtTravel,
  outlets,
  serviceAllowances,
  vehicles,
} from './schema';

type Row = Record<string, string>;

const REGIONAL_HUBS = new Set(['Kandy']);

function readCsv(dir: string, file: string): Row[] | null {
  const path = resolve(dir, file);
  if (!existsSync(path)) {
    console.warn(`[seed] ${file} not found in ${dir}; skipping`);
    return null;
  }
  return parse(readFileSync(path, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Row[];
}

const num = (v: string) => Number(v);
const flag = (v: string) => v === '1' || v.toLowerCase() === 'true';
const blankToNull = (v: string | undefined) => (v ? v : null);

/** "HH:MM-HH:MM" -> [open, close] */
function splitWindow(v: string | undefined): [string | null, string | null] {
  if (!v) return [null, null];
  const [open, close] = v.split('-').map((s) => s.trim());
  return [open || null, close || null];
}

/** SET clause that overwrites every non-key column with the incoming row. */
function excludedSet(table: PgTable, keys: string[]): Record<string, SQL> {
  return Object.fromEntries(
    Object.entries(getTableColumns(table))
      .filter(([prop]) => !keys.includes(prop))
      .map(([prop, col]) => [prop, sql.raw(`excluded."${col.name}"`)]),
  );
}

async function seedMasterData(db: Database, dir: string) {
  const outletRows = readCsv(dir, 'outlets.csv');
  const vehicleRows = readCsv(dir, 'vehicles.csv');
  const calendarRows = readCsv(dir, 'calendar.csv');
  const travelRows = readCsv(dir, 'district_travel.csv');
  const allowanceRows = readCsv(dir, 'service_allowance.csv');

  const depotIds = new Set<string>([
    ...(outletRows ?? []).map((r) => r.depot),
    ...(vehicleRows ?? []).map((r) => r.depot),
    ...(travelRows ?? []).map((r) => r.depot),
  ]);

  await db.transaction(async (tx) => {
    if (depotIds.size) {
      await tx
        .insert(depots)
        .values(
          [...depotIds].map((id) => ({
            id,
            name: id,
            isRegionalHub: REGIONAL_HUBS.has(id),
          })),
        )
        .onConflictDoUpdate({ target: depots.id, set: excludedSet(depots, ['id']) });
    }

    if (outletRows?.length) {
      await tx
        .insert(outlets)
        .values(
          outletRows.map((r) => {
            const [mallOpen, mallClose] = splitWindow(r.mall_window);
            return {
              id: r.outlet_id,
              name: blankToNull(r.outlet_name),
              brand: r.brand as Brand,
              district: r.district,
              depotId: r.depot,
              dockType: r.dock_type as DockType,
              parkingConstraint: r.parking_constraint as ParkingConstraint,
              mallWindowOpen: mallOpen,
              mallWindowClose: mallClose,
              windowOpen: r.window_open_time,
              windowClose: r.window_close_time,
            };
          }),
        )
        .onConflictDoUpdate({ target: outlets.id, set: excludedSet(outlets, ['id']) });
    }

    if (vehicleRows?.length) {
      await tx
        .insert(vehicles)
        .values(
          vehicleRows.map((r) => ({
            id: r.vehicle_id,
            type: r.type as VehicleType,
            temp: r.temp as VehicleTemp,
            weightCapKg: num(r.weight_cap_kg),
            volumeCapM3: num(r.volume_cap_m3),
            fuelType: r.fuel_type,
            kmPerL: num(r.km_per_l),
            weeklyFuelQuotaL: num(r.weekly_fuel_quota_l),
            depotId: r.depot,
          })),
        )
        // Keep `status` (workshop state is operational, not master data).
        .onConflictDoUpdate({
          target: vehicles.id,
          set: excludedSet(vehicles, ['id', 'status']),
        });
    }

    if (calendarRows?.length) {
      const values = calendarRows.map((r) => ({
        date: r.date,
        dow: num(r.dow),
        dowName: r.dow_name,
        isWeekend: flag(r.is_weekend),
        isoYear: num(r.iso_year),
        isoWeek: num(r.iso_week),
        isPayday: flag(r.is_payday),
        festival: blankToNull(r.festival),
        festivalRamp: num(r.festival_ramp || '0'),
        isHoliday: flag(r.is_holiday),
        monsoon: flag(r.monsoon),
        isOperating: flag(r.is_operating),
      }));
      // Chunk to stay well under Postgres' bind-parameter limit.
      for (let i = 0; i < values.length; i += 1000) {
        await tx
          .insert(calendarDays)
          .values(values.slice(i, i + 1000))
          .onConflictDoUpdate({
            target: calendarDays.date,
            set: excludedSet(calendarDays, ['date']),
          });
      }
    }

    if (travelRows?.length) {
      await tx
        .insert(districtTravel)
        .values(
          travelRows.map((r) => ({
            district: r.district,
            depotId: r.depot,
            roadClass: r.road_class,
            freeFlowKmh: num(r.free_flow_kmh),
            depotToDistrictKm: num(r.depot_to_district_km),
            depotToDistrictFreeflowMin: num(r.depot_to_district_freeflow_min),
            interStopKm: num(r.inter_stop_km),
            interStopFreeflowMin: num(r.inter_stop_freeflow_min),
          })),
        )
        .onConflictDoUpdate({
          target: [districtTravel.district, districtTravel.depotId],
          set: excludedSet(districtTravel, ['district', 'depotId']),
        });
    }

    if (allowanceRows?.length) {
      await tx
        .insert(serviceAllowances)
        .values(
          allowanceRows.map((r) => ({
            brand: r.brand as Brand,
            dockType: r.dock_type as DockType,
            minutes: num(r.service_allowance_min),
          })),
        )
        .onConflictDoUpdate({
          target: [serviceAllowances.brand, serviceAllowances.dockType],
          set: excludedSet(serviceAllowances, ['brand', 'dockType']),
        });
    }
  });

  console.log(
    `[seed] master data: ${depotIds.size} depots, ${outletRows?.length ?? 0} outlets, ` +
      `${vehicleRows?.length ?? 0} vehicles, ${calendarRows?.length ?? 0} calendar days, ` +
      `${travelRows?.length ?? 0} district travel rows, ${allowanceRows?.length ?? 0} service allowances`,
  );
}

async function main() {
  loadEnv();
  const dir = process.env.SEED_DATA_DIR
    ? resolve(process.env.SEED_DATA_DIR)
    : resolve(REPO_ROOT, 'data/seed');
  const pool = createPool(requireEnv('DATABASE_URL'));
  try {
    const db = createDatabase(pool);
    await seedMasterData(db, dir);
    // TODO(auth): create the four judge accounts (dispatcher, loader, driver,
    //   store_manager) through Better Auth's server API once the auth module
    //   lands, so passwords are hashed exactly like real sign-ups. Use
    //   SEED_*_USERNAME / SEED_USER_PASSWORD from .env.
    // TODO(demo-day): seed one realistic delivery day where demand exceeds
    //   capacity (confirmed orders + a few in_workshop vehicles) so the README
    //   judge walkthrough works on a fresh install.
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
