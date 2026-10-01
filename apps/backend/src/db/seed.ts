/**
 * Seeds reference data from the shared challenge datasets in data/seed/*.csv.
 * Idempotent: every table is upserted, so it runs on each `docker compose up`.
 * Connects as compass_owner (DIRECT_URL), which bypasses row-level security.
 *   dev:    pnpm db:seed
 *   docker: node dist/db/seed.js (run by the `seed` service)
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { ENGINE_DEFERRAL_REASONS } from '@waypoint/shared';
import { createDatabase, createPool, type Database } from './client';
import { loadEnv, ownerUrl, REPO_ROOT } from './env';
import { seedUsers } from './seed-users';
import {
  brandEnum,
  calendarDays,
  deferralReasons,
  depots,
  depotWaves,
  districts,
  dockTypeEnum,
  outlets,
  parkingEnum,
  roadClassEnum,
  serviceAllowances,
  vehicles,
  vehicleTempEnum,
  vehicleTypeEnum,
} from './schema';

type Row = Record<string, string>;

/** Dataset depot name -> depot id. */
const DEPOT_IDS: Record<string, string> = { Peliyagoda: 'PLG', Kandy: 'KDY' };

const DEFERRAL_REASON_LABELS: Record<string, string> = {
  REEFER_CAPACITY: 'No reefer capacity',
  VAN_SHORTAGE: 'No van for a van-only outlet',
  VEHICLE_CAPACITY: 'Over vehicle capacity',
  TIME_BUDGET: 'Over the daily time budget',
  FUEL_QUOTA: 'Weekly fuel quota reached',
  WINDOW_CONFLICT: 'Delivery window cannot be met',
  MANUAL: 'Dispatcher decision',
};

/** A4: Run 1 and Run 2 departure bands, in minutes after midnight. */
const WAVES = [
  {
    label: 'Run 1',
    departFromMin: 315,
    departToMin: 390,
    brands: ['FRESH', 'STYLE', 'TECH'],
  },
  {
    label: 'Run 2',
    departFromMin: 660,
    departToMin: 750,
    brands: ['STYLE', 'TECH'],
  },
] as const;

function readCsv(dir: string, file: string): Row[] | null {
  const path = resolve(dir, file);
  if (!existsSync(path)) {
    console.warn(`[seed] ${file} not found in ${dir}; skipping`);
    return null;
  }
  return parse<Row>(readFileSync(path, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });
}

const num = (v: string) => Number(v);
const flag = (v: string) => v === '1' || v.toLowerCase() === 'true';
const blankToNull = (v: string | undefined) => (v ? v : null);
const depotId = (name: string) =>
  DEPOT_IDS[name] ?? name.slice(0, 3).toUpperCase();
const slug = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const title = (brand: string) => brand[0] + brand.slice(1).toLowerCase();

/** Dataset value -> enum value: `van_only` becomes `VAN_ONLY`. */
function toEnum<T extends string>(
  values: readonly T[],
  raw: string,
  field: string,
): T {
  const v = raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_') as T;
  if (!values.includes(v)) {
    throw new Error(
      `[seed] ${field} "${raw}" is not one of ${values.join(', ')}`,
    );
  }
  return v;
}

/** "HH:MM" -> minutes after midnight. */
function toMinutes(v: string): number {
  const [h, m] = v.split(':').map(Number);
  return h * 60 + (m ?? 0);
}

/** "HH:MM-HH:MM" -> [open, close] in minutes. */
function splitWindow(v: string | undefined): [number | null, number | null] {
  if (!v) return [null, null];
  const [open, close] = v.split('-').map((s) => s.trim());
  return [open ? toMinutes(open) : null, close ? toMinutes(close) : null];
}

/** SET clause that overwrites every non-key column with the incoming row. */
function excludedSet(table: PgTable, keep: string[]): Record<string, SQL> {
  return Object.fromEntries(
    Object.entries(getTableColumns(table))
      .filter(([prop]) => !keep.includes(prop))
      .map(([prop, col]) => [prop, sql.raw(`excluded."${col.name}"`)]),
  );
}

async function seedReferenceData(db: Database, dir: string) {
  const outletRows = readCsv(dir, 'outlets.csv');
  const vehicleRows = readCsv(dir, 'vehicles.csv');
  const calendarRows = readCsv(dir, 'calendar.csv');
  const travelRows = readCsv(dir, 'district_travel.csv');
  const allowanceRows = readCsv(dir, 'service_allowance.csv');

  const depotNames = new Set<string>([
    ...(outletRows ?? []).map((r) => r.depot),
    ...(vehicleRows ?? []).map((r) => r.depot),
    ...(travelRows ?? []).map((r) => r.depot),
  ]);

  await db.transaction(async (tx) => {
    if (depotNames.size) {
      await tx
        .insert(depots)
        .values(
          [...depotNames].map((name): typeof depots.$inferInsert => ({
            id: depotId(name),
            name,
            kind: depotId(name) === 'PLG' ? 'CENTRAL' : 'REGIONAL',
          })),
        )
        // Keep what admins edit in A4 (address, docks, cutoff override).
        .onConflictDoUpdate({
          target: depots.id,
          set: {
            name: sql.raw('excluded."name"'),
            kind: sql.raw('excluded."kind"'),
          },
        });

      for (const name of depotNames) {
        for (const wave of WAVES) {
          await tx
            .insert(depotWaves)
            .values({
              depotId: depotId(name),
              ...wave,
              brands: [...wave.brands],
            })
            .onConflictDoNothing({
              target: [depotWaves.depotId, depotWaves.label],
            });
        }
      }
    }

    if (travelRows?.length) {
      await tx
        .insert(districts)
        .values(
          travelRows.map((r) => ({
            id: slug(r.district),
            name: r.district,
            depotId: depotId(r.depot),
            roadClass: toEnum(
              roadClassEnum.enumValues,
              r.road_class,
              'road_class',
            ),
            freeFlowKmh: num(r.free_flow_kmh),
            depotToDistrictKm: num(r.depot_to_district_km),
            depotToDistrictMin: num(r.depot_to_district_freeflow_min),
            interStopKm: num(r.inter_stop_km),
            interStopMin: num(r.inter_stop_freeflow_min),
          })),
        )
        .onConflictDoUpdate({
          target: districts.id,
          set: excludedSet(districts, ['id', 'centroidLat', 'centroidLng']),
        });
    }

    if (outletRows?.length) {
      // Placeholder names ("Fresh Gampaha 3") until ROO-22 adds the town list.
      const counters = new Map<string, number>();
      const sorted = [...outletRows].sort((a, b) =>
        a.outlet_id.localeCompare(b.outlet_id),
      );
      await tx
        .insert(outlets)
        .values(
          sorted.map((r) => {
            const brand = toEnum(brandEnum.enumValues, r.brand, 'brand');
            const key = `${brand}:${r.district}`;
            counters.set(key, (counters.get(key) ?? 0) + 1);
            const [mallOpen, mallClose] = splitWindow(r.mall_window);
            return {
              id: r.outlet_id,
              name:
                blankToNull(r.outlet_name) ??
                `${title(brand)} ${r.district} ${counters.get(key)}`,
              brand,
              districtId: slug(r.district),
              depotId: depotId(r.depot),
              dockType: toEnum(
                dockTypeEnum.enumValues,
                r.dock_type,
                'dock_type',
              ),
              parkingConstraint: toEnum(
                parkingEnum.enumValues,
                r.parking_constraint,
                'parking_constraint',
              ),
              mallWindowOpenMin: mallOpen,
              mallWindowCloseMin: mallClose,
              windowOpenMin: toMinutes(r.window_open_time),
              windowCloseMin: toMinutes(r.window_close_time),
            };
          }),
        )
        // Keep what people edit (name, contact, access notes, map position).
        .onConflictDoUpdate({
          target: outlets.id,
          set: excludedSet(outlets, [
            'id',
            'name',
            'styleDeliveryDow',
            'address',
            'lat',
            'lng',
            'receivingContactName',
            'receivingContactPhone',
            'accessNotes',
            'accessNotesUpdatedAt',
            'accessNotesUpdatedById',
            'createdAt',
          ]),
        });
    }

    if (vehicleRows?.length) {
      // Codes by depot (Peliyagoda first), then id: REF-01 reefer trucks,
      // DRY-01 ambient trucks, VAN-01 vans. Plates are synthetic.
      const order = [...vehicleRows].sort(
        (a, b) =>
          Number(depotId(a.depot) !== 'PLG') -
            Number(depotId(b.depot) !== 'PLG') ||
          a.depot.localeCompare(b.depot) ||
          a.vehicle_id.localeCompare(b.vehicle_id),
      );
      const counters = new Map<string, number>();
      await tx
        .insert(vehicles)
        .values(
          order.map((r, i) => {
            const type = toEnum(vehicleTypeEnum.enumValues, r.type, 'type');
            const temp = toEnum(vehicleTempEnum.enumValues, r.temp, 'temp');
            const prefix =
              type === 'VAN' ? 'VAN' : temp === 'REEFER' ? 'REF' : 'DRY';
            const n = (counters.get(prefix) ?? 0) + 1;
            counters.set(prefix, n);
            return {
              id: r.vehicle_id,
              code: `${prefix}-${String(n).padStart(2, '0')}`,
              registrationNo: `WP CB-${String(1001 + i)}`,
              type,
              temp,
              weightCapKg: num(r.weight_cap_kg),
              volumeCapM3: num(r.volume_cap_m3),
              fuelType: r.fuel_type,
              kmPerL: num(r.km_per_l),
              weeklyFuelQuotaL: num(r.weekly_fuel_quota_l),
              depotId: depotId(r.depot),
            };
          }),
        )
        // Keep operational state (status is not master data).
        .onConflictDoUpdate({
          target: vehicles.id,
          set: excludedSet(vehicles, [
            'id',
            'status',
            'statusReason',
            'statusChangedAt',
            'version',
            'createdAt',
          ]),
        });
    }

    if (calendarRows?.length) {
      const values = calendarRows.map((r) => ({
        date: r.date,
        dow: num(r.dow),
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

    if (allowanceRows?.length) {
      await tx
        .insert(serviceAllowances)
        .values(
          allowanceRows.map((r) => ({
            brand: toEnum(brandEnum.enumValues, r.brand, 'brand'),
            dockType: toEnum(dockTypeEnum.enumValues, r.dock_type, 'dock_type'),
            minutes: num(r.service_allowance_min),
          })),
        )
        .onConflictDoUpdate({
          target: [serviceAllowances.brand, serviceAllowances.dockType],
          set: excludedSet(serviceAllowances, ['brand', 'dockType']),
        });
    }

    // Engine reasons can't be removed in A6; admins add their own beside them.
    const reasons = [...ENGINE_DEFERRAL_REASONS, 'MANUAL'];
    await tx
      .insert(deferralReasons)
      .values(
        reasons.map((code, i) => ({
          code,
          label: DEFERRAL_REASON_LABELS[code] ?? code,
          fromEngine: code !== 'MANUAL',
          sortOrder: i,
        })),
      )
      .onConflictDoNothing({ target: deferralReasons.code });
  });

  console.log(
    `[seed] reference data: ${depotNames.size} depots, ${travelRows?.length ?? 0} districts, ` +
      `${outletRows?.length ?? 0} outlets, ${vehicleRows?.length ?? 0} vehicles, ` +
      `${calendarRows?.length ?? 0} calendar days, ${allowanceRows?.length ?? 0} service allowances`,
  );
}

async function main() {
  loadEnv();
  const dir = process.env.SEED_DATA_DIR
    ? resolve(process.env.SEED_DATA_DIR)
    : resolve(REPO_ROOT, 'data/seed');
  const pool = createPool(ownerUrl());
  try {
    const db = createDatabase(pool);
    await seedReferenceData(db, dir);
    const password = process.env.SEED_PASSWORD ?? '';
    if (password.length >= 10) await seedUsers(db, password);
    else
      console.warn(
        '[seed] SEED_PASSWORD needs 10+ characters; skipping persona accounts',
      );
    // TODO(ROO-22): items catalog, settings, 14 days of history from
    //   deliveries_train.csv, and the S1 demo day where demand exceeds capacity.
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
