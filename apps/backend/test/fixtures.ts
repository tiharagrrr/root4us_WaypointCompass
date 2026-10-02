import { randomBytes } from 'node:crypto';
import type { Database } from '../src/db/client';
import {
  calendarDays,
  depots,
  devices,
  districts,
  items,
  outlets,
  plans,
  trips,
  vehicles,
} from '../src/db/schema';

/** A random suffix, so fixtures never collide with earlier runs or the seed. */
export const suffix = () => randomBytes(3).toString('hex');

/** Two depots standing in for Peliyagoda and Kandy, each with one district. */
export async function depotFixture(db: Database, sfx: string) {
  const ids = {
    plg: `P${sfx}`,
    kdy: `K${sfx}`,
    plgDistrict: `gampaha-${sfx}`,
    kdyDistrict: `kandy-${sfx}`,
  };
  await db.insert(depots).values([
    { id: ids.plg, name: `Peliyagoda ${sfx}` },
    { id: ids.kdy, name: `Kandy ${sfx}` },
  ]);
  const travel = {
    roadClass: 'URBAN' as const,
    freeFlowKmh: 30,
    depotToDistrictKm: 20,
    depotToDistrictMin: 37,
    interStopKm: 4,
    interStopMin: 9,
  };
  await db.insert(districts).values([
    {
      id: ids.plgDistrict,
      name: `Gampaha ${sfx}`,
      depotId: ids.plg,
      ...travel,
    },
    { id: ids.kdyDistrict, name: `Kandy ${sfx}`, depotId: ids.kdy, ...travel },
  ]);
  return ids;
}

/** What an outlet fixture may differ from a plain Fresh outlet in. */
export interface OutletOptions {
  brand?: (typeof outlets.$inferInsert)['brand'];
  name?: string;
  dockType?: (typeof outlets.$inferInsert)['dockType'];
  parkingConstraint?: (typeof outlets.$inferInsert)['parkingConstraint'];
  windowOpenMin?: number;
  windowCloseMin?: number;
  mallWindowOpenMin?: number | null;
  mallWindowCloseMin?: number | null;
  /** Style's weekly delivery day, 0 = Monday. */
  styleDeliveryDow?: number | null;
}

/** An outlet in a depot's district; Fresh with a 05:30–07:30 window by default. */
export async function outletFixture(
  db: Database,
  id: string,
  depot: { depotId: string; districtId: string },
  options: OutletOptions = {},
) {
  const brand = options.brand ?? 'FRESH';
  await db.insert(outlets).values({
    id,
    name: options.name ?? `${titleCase(brand)} ${id}`,
    brand,
    dockType: options.dockType ?? 'REAR_DOCK',
    parkingConstraint: options.parkingConstraint ?? 'NORMAL',
    windowOpenMin: options.windowOpenMin ?? 330,
    windowCloseMin: options.windowCloseMin ?? 450,
    mallWindowOpenMin: options.mallWindowOpenMin ?? null,
    mallWindowCloseMin: options.mallWindowCloseMin ?? null,
    styleDeliveryDow: options.styleDeliveryDow ?? null,
    ...depot,
  });
  return id;
}

const titleCase = (s: string) => s[0] + s.slice(1).toLowerCase();

/** One catalog item. Weight and volume are whole numbers, so totals are exact. */
export async function itemFixture(
  db: Database,
  input: {
    sku: string;
    brand?: (typeof items.$inferInsert)['brand'];
    tempClass?: (typeof items.$inferInsert)['tempClass'];
    name?: string;
    category?: string;
    packLabel?: string;
    unitWeightKg?: number;
    unitVolumeM3?: number;
    unitValueLkr?: number | null;
    active?: boolean;
  },
): Promise<string> {
  const [row] = await db
    .insert(items)
    .values({
      sku: input.sku,
      name: input.name ?? `Item ${input.sku}`,
      brand: input.brand ?? 'FRESH',
      category: input.category ?? 'Staples',
      tempClass: input.tempClass ?? 'AMBIENT',
      packLabel: input.packLabel ?? 'Case of 6',
      unitWeightKg: input.unitWeightKg ?? 10,
      unitVolumeM3: input.unitVolumeM3 ?? 0.02,
      unitValueLkr: input.unitValueLkr ?? null,
      active: input.active ?? true,
    })
    .returning({ id: items.id });
  return row.id;
}

/**
 * Calendar rows for the demo window of specs/ordering/spec.md: 2026-09-30 to
 * 2026-10-03 operate and 2026-10-04 (a Sunday) does not. Dates with no row
 * fall back to Monday to Saturday, which is what AC-MD-10 checks.
 */
export const DEMO_DAYS: Record<string, boolean> = {
  '2026-09-28': true,
  '2026-09-29': true,
  '2026-09-30': true,
  '2026-10-01': true,
  '2026-10-02': true,
  '2026-10-03': true,
  '2026-10-04': false,
};

export async function calendarFixture(
  db: Database,
  days: Record<string, boolean> = DEMO_DAYS,
): Promise<void> {
  const rows = Object.entries(days).map(([date, isOperating]) => {
    const at = new Date(`${date}T00:00:00Z`);
    const dow = (at.getUTCDay() + 6) % 7; // 0 = Monday
    return {
      date,
      dow,
      isWeekend: dow >= 5,
      isoYear: at.getUTCFullYear(),
      isoWeek: isoWeekOf(at),
      isPayday: false,
      festival: null,
      festivalRamp: 1,
      isHoliday: !isOperating,
      monsoon: false,
      isOperating,
    };
  });
  await db.insert(calendarDays).values(rows).onConflictDoNothing();
}

function isoWeekOf(at: Date): number {
  const thursday = new Date(at);
  thursday.setUTCDate(at.getUTCDate() + 3 - ((at.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  return (
    1 +
    Math.round(
      (thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000),
    )
  );
}

/** A registered device; a dock device when depotId is given. */
export async function deviceFixture(
  db: Database,
  id: string,
  dock?: { depotId: string },
) {
  await db.insert(devices).values({
    id,
    platform: 'PWA',
    isDockDevice: Boolean(dock),
    depotId: dock?.depotId ?? null,
  });
  return id;
}

/** An ambient truck based at a depot. */
export async function vehicleFixture(
  db: Database,
  id: string,
  depotId: string,
) {
  await db.insert(vehicles).values({
    id,
    code: id,
    registrationNo: `REG-${id}`,
    type: 'TRUCK',
    temp: 'AMBIENT',
    weightCapKg: 3000,
    volumeCapM3: 20,
    fuelType: 'diesel',
    kmPerL: 6,
    weeklyFuelQuotaL: 400,
    depotId,
  });
  return id;
}

/** A plan for a depot and business date with one trip for a driver (what "trips today" reads). */
export async function tripFixture(
  db: Database,
  input: {
    depotId: string;
    districtId: string;
    driverId: string;
    date: string;
    status?: (typeof trips.$inferInsert)['status'];
  },
) {
  const vehicleId = await vehicleFixture(db, `DRY-${suffix()}`, input.depotId);
  const [plan] = await db
    .insert(plans)
    .values({ depotId: input.depotId, date: input.date })
    .returning({ id: plans.id });
  const [trip] = await db
    .insert(trips)
    .values({
      planId: plan.id,
      depotId: input.depotId,
      vehicleId,
      driverId: input.driverId,
      brand: 'FRESH',
      districtId: input.districtId,
      tempClass: 'AMBIENT',
      status: input.status ?? 'PLANNED',
    })
    .returning({ id: trips.id });
  return { planId: plan.id, tripId: trip.id };
}
