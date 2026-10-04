/**
 * The persona seed against a migrated database, inside a transaction that is
 * rolled back, so the reference rows it needs (PLG, KDY, OUT014, OUT976,
 * REF-07, DRY-31, TST-76) never stay behind. Runs when TEST_DIRECT_URL is set.
 */
import { verifyPassword } from 'better-auth/crypto';
import { and, eq, inArray, or } from 'drizzle-orm';
import { createDatabase, createPool, type Database } from '../client';
import {
  accounts,
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
  'kasun.b@waypoint.lk',
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
    const outlet = {
      brand: 'FRESH' as const,
      districtId: 'seed-test-gampaha',
      depotId: 'PLG',
      dockType: 'REAR_DOCK' as const,
      parkingConstraint: 'NORMAL' as const,
      windowOpenMin: 330,
      windowCloseMin: 450,
    };
    await tx
      .insert(outlets)
      .values([
        { id: 'OUT014', name: 'Fresh Kadawatha', ...outlet },
        { id: 'OUT976', name: 'Fresh Seed Test', ...outlet },
      ])
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
        {
          id: 'seed-test-tst76',
          code: 'TST-76',
          registrationNo: 'WP SEED-76',
          depotId: 'PLG',
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
          'Kasun Bandara',
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
  /** The drivers of the vehicle with this code; codes, not ids, are what the seed keys on. */
  const driversOf = async (tx: Database, code: string) => {
    const [vehicle] = await tx
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.code, code));
    return tx
      .select()
      .from(users)
      .where(
        and(eq(users.role, 'driver'), eq(users.defaultVehicleId, vehicle.id)),
      );
  };

  it('AC-IDN-61 the seed gives every vehicle exactly one driver', async () => {
    await rolledBack(async (tx) => {
      await referenceData(tx);
      await seedUsers(tx, 'Waypoint@2026');
      const [first] = await driversOf(tx, 'TST-76');
      await seedUsers(tx, 'Waypoint@2026');

      const tst76 = await driversOf(tx, 'TST-76');
      expect(tst76).toHaveLength(1);
      expect(tst76[0]).toMatchObject({
        id: first.id,
        username: 'drv.tst76',
        depotId: 'PLG',
        phoneNumberVerified: true,
        email: `${first.id}@drivers.waypoint.local`,
      });
      expect(tst76[0].phoneNumber).toMatch(/^\+947000\d{5}$/);

      const ref07 = await driversOf(tx, 'REF-07');
      expect(ref07.map((u) => u.name)).toEqual(['Aniqa Razick']);

      const fleet = await tx.select({ id: vehicles.id }).from(vehicles);
      const driven = new Set(
        (
          await tx
            .select({ vehicleId: users.defaultVehicleId })
            .from(users)
            .where(eq(users.role, 'driver'))
        ).map((u) => u.vehicleId),
      );
      expect(fleet.filter((v) => !driven.has(v.id))).toEqual([]);
    });
  });

  it('AC-IDN-62 the seed gives every outlet a store manager who can sign in', async () => {
    await rolledBack(async (tx) => {
      await referenceData(tx);
      await seedUsers(tx, 'Waypoint@2026');

      const managers = await tx
        .select()
        .from(users)
        .where(
          and(
            eq(users.role, 'store_manager'),
            inArray(users.outletId, ['OUT014', 'OUT976']),
          ),
        );
      expect(
        managers.filter((u) => u.outletId === 'OUT976').map((u) => u.username),
      ).toEqual(['mgr.out976']);
      expect(
        managers
          .filter((u) => u.username?.startsWith('mgr.'))
          .map((u) => u.outletId),
      ).toEqual(['OUT976']);
      const manager = managers.find((u) => u.outletId === 'OUT976')!;
      expect(manager.email).toBe('mgr.out976@waypoint.lk');
      const [credential] = await tx
        .select({ password: accounts.password })
        .from(accounts)
        .where(
          and(
            eq(accounts.userId, manager.id),
            eq(accounts.providerId, 'credential'),
          ),
        );
      expect(
        await verifyPassword({
          hash: credential.password!,
          password: 'Waypoint@2026',
        }),
      ).toBe(true);

      const [kasun] = (await personas(tx)).filter(
        (u) => u.name === 'Kasun Bandara',
      );
      expect(kasun).toMatchObject({ role: 'loader', depotId: 'KDY' });
      expect(
        await verifyPassword({ hash: kasun.pinHash!, password: '1357' }),
      ).toBe(true);
    });
  });
});
