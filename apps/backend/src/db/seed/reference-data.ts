/**
 * Reference data from the booklet's files: depots and their waves, districts, outlets, vehicles,
 * the calendar, service allowances and deferral reasons. Every table is upserted, keeping what
 * people edit, so it runs on every seed.
 */
import {
  and,
  eq,
  getTableColumns,
  notInArray,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Database } from '../client';
import { deferralReasonRows } from '../deferral-reasons.seed';
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
  roadConditions,
  serviceAllowances,
  trafficSpeeds,
  vehicles,
  vehicleTempEnum,
  vehicleTypeEnum,
} from '../schema';
import {
  CONDITION_FILES,
  knownDistrictsOnly,
  parseRoadConditions,
  parseTrafficSpeeds,
} from './conditions';
import { flag, readSeedCsv, slug, toMinutes, type Row } from './csv';

/** Dataset depot name -> depot id. */
const DEPOT_IDS: Record<string, string> = { Peliyagoda: 'PLG', Kandy: 'KDY' };

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
  const rows = readSeedCsv(dir, file);
  if (!rows) console.warn(`[seed] ${file} not found in ${dir}; skipping`);
  return rows;
}

const num = (v: string) => Number(v);
const blankToNull = (v: string | undefined) => (v ? v : null);
const depotId = (name: string) =>
  DEPOT_IDS[name] ?? name.slice(0, 3).toUpperCase();
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

export async function seedReferenceData(db: Database, dir: string) {
  const outletRows = readCsv(dir, 'outlets.csv');
  const vehicleRows = readCsv(dir, 'vehicles.csv');
  const calendarRows = readCsv(dir, 'calendar.csv');
  const travelRows = readCsv(dir, 'district_travel.csv');
  const allowanceRows = readCsv(dir, 'service_allowance.csv');
  const trafficRows = readCsv(dir, CONDITION_FILES.traffic);
  const roadRows = readCsv(dir, CONDITION_FILES.road);
  /** Both files key on the district; a row for one the reference data lacks is skipped. */
  const skipped = { traffic: 0, road: 0 };

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

    // Traffic speeds and road conditions are the dataset and nothing else (no admin edits them),
    // so each table becomes exactly its file: cleared, then filled.
    if (trafficRows || roadRows) {
      const known = new Set(
        (await tx.select({ id: districts.id }).from(districts)).map(
          (d) => d.id,
        ),
      );
      if (trafficRows) {
        const parsed = knownDistrictsOnly(
          parseTrafficSpeeds(trafficRows),
          known,
        );
        skipped.traffic = parsed.skipped;
        await tx.delete(trafficSpeeds);
        for (let i = 0; i < parsed.rows.length; i += 1000)
          await tx.insert(trafficSpeeds).values(parsed.rows.slice(i, i + 1000));
      }
      if (roadRows) {
        const parsed = knownDistrictsOnly(parseRoadConditions(roadRows), known);
        skipped.road = parsed.skipped;
        await tx.delete(roadConditions);
        for (let i = 0; i < parsed.rows.length; i += 1000)
          await tx
            .insert(roadConditions)
            .values(parsed.rows.slice(i, i + 1000));
      }
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
    // The label and description are left alone on a re-run, so an admin's
    // relabel survives; only what the engine decides is brought up to date.
    const reasons = deferralReasonRows();
    await tx
      .insert(deferralReasons)
      .values(reasons)
      .onConflictDoUpdate({
        target: deferralReasons.code,
        set: excludedSet(deferralReasons, [
          'code',
          'label',
          'description',
          'active',
        ]),
      });
    // A code the engine no longer emits (from an older seed) becomes an
    // inactive admin reason, so A6 can retire it and nothing picks it again.
    await tx
      .update(deferralReasons)
      .set({ fromEngine: false, active: false })
      .where(
        and(
          eq(deferralReasons.fromEngine, true),
          notInArray(
            deferralReasons.code,
            reasons.map((r) => r.code),
          ),
        ),
      );
  });

  console.log(
    `[seed] reference data: ${depotNames.size} depots, ${travelRows?.length ?? 0} districts, ` +
      `${outletRows?.length ?? 0} outlets, ${vehicleRows?.length ?? 0} vehicles, ` +
      `${calendarRows?.length ?? 0} calendar days, ${allowanceRows?.length ?? 0} service allowances, ` +
      `${(trafficRows?.length ?? 0) - skipped.traffic} traffic speeds, ` +
      `${(roadRows?.length ?? 0) - skipped.road} road conditions`,
  );
  for (const [what, n] of Object.entries(skipped))
    if (n)
      console.warn(
        `[seed] ${n} ${what} rows name a district that is not in district_travel.csv; skipped`,
      );
}
