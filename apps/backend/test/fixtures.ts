import { randomBytes } from 'node:crypto';
import type { Database } from '../src/db/client';
import {
  depots,
  devices,
  districts,
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

/** A Fresh outlet in a depot's district. */
export async function outletFixture(
  db: Database,
  id: string,
  depot: { depotId: string; districtId: string },
) {
  await db.insert(outlets).values({
    id,
    name: `Fresh ${id}`,
    brand: 'FRESH',
    dockType: 'REAR_DOCK',
    parkingConstraint: 'NORMAL',
    windowOpenMin: 330,
    windowCloseMin: 450,
    ...depot,
  });
  return id;
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
