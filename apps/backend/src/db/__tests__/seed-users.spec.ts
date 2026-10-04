/**
 * The persona seed against a migrated database, inside a transaction that is
 * rolled back, so the reference rows it needs (PLG, KDY, OUT014, REF-07,
 * DRY-31) never stay behind. Runs when TEST_DIRECT_URL is set.
 */
import { verifyPassword } from 'better-auth/crypto';
import { inArray, or } from 'drizzle-orm';
import { createDatabase, createPool, type Database } from '../client';
import {
  depots,
  devices,
  districts,
  notifications,
  outlets,
  users,
  vehicles,
} from '../schema';
import { seedUsers } from '../seed-users';

const suite = process.env.TEST_DIRECT_URL ? describe : describe.skip;

const EMAILS = [
  'rusiru.w@waypoint.lk',
  'tihara.e@waypoint.lk',
  'nimesha.p@waypoint.lk',
  'harini.d@waypoint.lk',
];
const PHONES = ['+94776041932', '+94775550107'];

class Rollback extends Error {}

suite('seedUsers', () => {
  jest.setTimeout(60_000);
  const pool = createPool(process.env.TEST_DIRECT_URL ?? '');
  const db = createDatabase(pool);
  afterAll(() => pool.end());

  /** Runs `work` in a transaction that never commits. */
  async function rolledBack(work: (tx: Database) => Promise<void>) {
    await db
      .transaction(async (tx) => {
        await work(tx);
        throw new Rollback();
      })
      .catch((err: unknown) => {
        if (!(err instanceof Rollback)) throw err;
      });
  }

  async function referenceData(tx: Database) {
    await tx
      .insert(depots)
      .values([
        { id: 'PLG', name: 'Peliyagoda' },
        { id: 'KDY', name: 'Kandy' },
      ])
      .onConflictDoNothing();
    await tx
      .insert(districts)
      .values({
        id: 'seed-test-gampaha',
        name: 'Gampaha (seed test)',
        depotId: 'PLG',
        roadClass: 'URBAN',
        freeFlowKmh: 30,
        depotToDistrictKm: 20,
        depotToDistrictMin: 37,
        interStopKm: 4,
        interStopMin: 9,
      })
      .onConflictDoNothing();
    await tx
      .insert(outlets)
      .values({
        id: 'OUT014',
        name: 'Fresh Kadawatha',
        brand: 'FRESH',
        districtId: 'seed-test-gampaha',
        depotId: 'PLG',
        dockType: 'REAR_DOCK',
        parkingConstraint: 'NORMAL',
        windowOpenMin: 330,
        windowCloseMin: 450,
      })
      .onConflictDoNothing();
    const truck = {
      type: 'TRUCK' as const,
      weightCapKg: 5000,
      volumeCapM3: 30,
      fuelType: 'diesel',
      kmPerL: 8,
      weeklyFuelQuotaL: 400,
    };
    await tx
      .insert(vehicles)
      .values([
        {
          id: 'seed-test-ref07',
          code: 'REF-07',
          registrationNo: 'WP SEED-07',
          depotId: 'PLG',
          temp: 'REEFER',
          ...truck,
        },
        {
          id: 'seed-test-dry31',
          code: 'DRY-31',
          registrationNo: 'WP SEED-31',
          depotId: 'KDY',
          temp: 'AMBIENT',
          ...truck,
        },
      ])
      .onConflictDoNothing();
    // Start from no personas, so the create path runs. Their notifications go
    // first: that foreign key does not cascade.
    const isPersona = or(
      inArray(users.email, EMAILS),
      inArray(users.phoneNumber, PHONES),
    );
    await tx
      .delete(notifications)
      .where(
        inArray(
          notifications.userId,
          tx.select({ id: users.id }).from(users).where(isPersona),
        ),
      );
    await tx.delete(users).where(isPersona);
  }

  const personas = (tx: Database) =>
    tx
      .select()
      .from(users)
      .where(
        or(inArray(users.email, EMAILS), inArray(users.phoneNumber, PHONES)),
      );

  it('creates one account per role with its scope, idempotently', async () => {
    await rolledBack(async (tx) => {
      await referenceData(tx);
      await seedUsers(tx, 'Waypoint@2026');
      const first = await personas(tx);
      await seedUsers(tx, 'Waypoint@2026');
      const second = await personas(tx);

      expect(second.map((u) => u.id).sort()).toEqual(
        first.map((u) => u.id).sort(),
      );
      const byName = Object.fromEntries(second.map((u) => [u.name, u]));
      expect(Object.keys(byName).sort()).toEqual(
        [
          'Aniqa Razick',
          'Dinushi Rathnayake',
          'Harini De Mel',
          'Nimesha Periyapperuma',
          'Rusiru Withanage',
          'Tihara Egodage',
        ].sort(),
      );
      expect(byName['Rusiru Withanage']).toMatchObject({ role: 'admin' });
      expect(byName['Tihara Egodage']).toMatchObject({
        role: 'dispatcher',
        depotId: null,
      });
      expect(byName['Nimesha Periyapperuma']).toMatchObject({
        role: 'store_manager',
        outletId: 'OUT014',
      });

      const vehicleByCode = new Map(
        (
          await tx
            .select({
              code: vehicles.code,
              id: vehicles.id,
              depotId: vehicles.depotId,
            })
            .from(vehicles)
            .where(inArray(vehicles.code, ['REF-07', 'DRY-31']))
        ).map((v) => [v.code, v]),
      );
      const ref07 = vehicleByCode.get('REF-07')!;
      const dry31 = vehicleByCode.get('DRY-31')!;
      const aniqa = byName['Aniqa Razick'];
      expect(aniqa).toMatchObject({
        role: 'driver',
        phoneNumber: '+94776041932',
        phoneNumberVerified: true,
        defaultVehicleId: ref07.id,
        depotId: ref07.depotId,
        email: `${aniqa.id}@drivers.waypoint.local`,
      });
      expect(byName['Dinushi Rathnayake']).toMatchObject({
        defaultVehicleId: dry31.id,
      });

      const harini = byName['Harini De Mel'];
      expect(harini).toMatchObject({ role: 'loader', depotId: 'PLG' });
      expect(harini.pinHash).not.toBe('2468');
      expect(
        await verifyPassword({ hash: harini.pinHash!, password: '2468' }),
      ).toBe(true);

      const docks = await tx
        .select({
          id: devices.id,
          depotId: devices.depotId,
          isDock: devices.isDockDevice,
        })
        .from(devices)
        .where(inArray(devices.id, ['dock-plg-01', 'dock-kdy-01']))
        .orderBy(devices.id);
      expect(docks).toEqual([
        { id: 'dock-kdy-01', depotId: 'KDY', isDock: true },
        { id: 'dock-plg-01', depotId: 'PLG', isDock: true },
      ]);
    });
  });
});
