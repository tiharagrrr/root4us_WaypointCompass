import type { NestExpressApplication } from '@nestjs/platform-express';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { UserRole } from '@waypoint/shared';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { bodyOf, signedInAs } from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import {
  depotFixture,
  outletFixture,
  suffix,
  vehicleFixture,
} from '../../../../test/fixtures';
import { expectProblem, freezeClock } from '../../../../test/kernel';
import { JobContextRunner } from '../../../core/context/job-context';
import type { Database } from '../../../db/client';
import { fuelLedgerEntries, plans, trips } from '../../../db/schema';
import type { FuelWeekDto } from '../dto/fuel-week.dto';
import { FuelLedgerService } from '../services/fuel-ledger.service';
import { VehicleQueries } from '../services/vehicle.queries';

/**
 * The weekly fuel ledger planning writes into and reads from
 * (specs/fleet/spec.md). 2026-10-02 is in ISO week 40 of 2026.
 */
describeWithDb('fleet: vehicles and the fuel ledger', () => {
  jest.setTimeout(120_000);

  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  const sfx = suffix();
  let depot: Awaited<ReturnType<typeof depotFixture>>;
  let vehicle: string;
  let other: string;
  let kandyVehicle: string;

  /** Runs service code the way planning does: in a job's transaction. */
  const inTx = <T>(work: () => Promise<T>) =>
    app
      .get(JobContextRunner)
      .run({ id: `test:fleet:${suffix()}` }, () =>
        app.get<TransactionHost>(TransactionHost).withTransaction(work),
      );

  /** The PLG plan for a date (created on first use) with one trip on a vehicle. */
  async function aTrip(vehicleId: string, date: string) {
    await db
      .insert(plans)
      .values({ depotId: depot.plg, date })
      .onConflictDoNothing();
    const [plan] = await db
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.depotId, depot.plg), eq(plans.date, date)));
    const [trip] = await db
      .insert(trips)
      .values({
        planId: plan.id,
        depotId: depot.plg,
        vehicleId,
        brand: 'FRESH',
        districtId: depot.plgDistrict,
        tempClass: 'AMBIENT',
      })
      .returning({ id: trips.id });
    return { planId: plan.id, tripId: trip.id };
  }

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    depot = await depotFixture(db, sfx);
    await outletFixture(db, `OUT${sfx}`, {
      depotId: depot.plg,
      districtId: depot.plgDistrict,
    });
    // weeklyFuelQuotaL 400 and kmPerL 6 (vehicleFixture).
    vehicle = await vehicleFixture(db, `DRY-A${sfx}`, depot.plg);
    other = await vehicleFixture(db, `DRY-B${sfx}`, depot.plg);
    kandyVehicle = await vehicleFixture(db, `DRY-K${sfx}`, depot.kdy);
    freezeClock(app, '2026-10-01T16:05:00+05:30');
  });

  afterAll(async () => {
    freezeClock(app, '2026-10-01T16:05:00+05:30').reset();
    await close();
    await app.close();
  });

  it('lists a depot’s vehicles for the engine, sorted by id', async () => {
    const rows = await inTx(() => app.get(VehicleQueries).forDepot(depot.plg));
    expect(rows.map((v) => v.id)).toEqual([vehicle, other].sort());
    expect(rows.every((v) => v.depotId === depot.plg)).toBe(true);
  });

  it('writes one PLANNED entry per published trip, in the trip date’s ISO week', async () => {
    const { tripId } = await aTrip(vehicle, '2026-10-02');
    await inTx(() =>
      app.get(FuelLedgerService).addPlanned([
        {
          tripId,
          vehicleId: vehicle,
          date: '2026-10-02',
          km: 60,
          litres: 10,
        },
      ]),
    );
    const rows = await db
      .select()
      .from(fuelLedgerEntries)
      .where(eq(fuelLedgerEntries.tripId, tripId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      vehicleId: vehicle,
      kind: 'PLANNED',
      km: 60,
      litres: 10,
      isoYear: 2026,
      isoWeek: 40,
      date: '2026-10-02',
    });
  });

  it('reverses a trip’s planned fuel with a new negative entry', async () => {
    const { tripId } = await aTrip(other, '2026-10-02');
    const ledger = app.get(FuelLedgerService);
    await inTx(() =>
      ledger.addPlanned([
        { tripId, vehicleId: other, date: '2026-10-02', km: 72, litres: 12 },
      ]),
    );
    expect(
      await inTx(() => ledger.weekOf(other, { isoYear: 2026, isoWeek: 40 })),
    ).toMatchObject({ plannedL: 12, leftL: 388 });

    await inTx(() => ledger.reversePlanned([tripId]));
    // A second reversal finds nothing left to reverse.
    await inTx(() => ledger.reversePlanned([tripId]));

    const rows = await db
      .select()
      .from(fuelLedgerEntries)
      .where(eq(fuelLedgerEntries.tripId, tripId));
    expect(rows.map((r) => r.litres).sort((a, b) => a - b)).toEqual([-12, 12]);
    expect(rows.every((r) => r.kind === 'PLANNED' && r.isoWeek === 40)).toBe(
      true,
    );
    expect(
      await inTx(() => ledger.weekOf(other, { isoYear: 2026, isoWeek: 40 })),
    ).toMatchObject({ plannedL: 0, actualL: 0, leftL: 400 });
  });

  it('counts this week’s fuel for the engine, leaving out the plan being built', async () => {
    const third = await vehicleFixture(db, `DRY-C${sfx}`, depot.plg);
    const earlier = await aTrip(third, '2026-09-29');
    const lastWeek = await aTrip(third, '2026-09-25');
    const ledger = app.get(FuelLedgerService);
    await inTx(() =>
      ledger.addPlanned([
        { ...earlier, vehicleId: third, date: '2026-09-29', km: 30, litres: 5 },
        {
          ...lastWeek,
          vehicleId: third,
          date: '2026-09-25',
          km: 300,
          litres: 50,
        },
      ]),
    );
    const today = await aTrip(third, '2026-10-02');
    await inTx(() =>
      ledger.addPlanned([
        { ...today, vehicleId: third, date: '2026-10-02', km: 42, litres: 7 },
      ]),
    );

    const used = await inTx(() =>
      ledger.usedThisWeek([third], '2026-10-02', {
        excludePlanId: today.planId,
      }),
    );
    // 5 L earlier this week; last week's 50 L and this plan's own 7 L do not count.
    expect(used.get(third)).toBe(5);
    const all = await inTx(() => ledger.usedThisWeek([third], '2026-10-02'));
    expect(all.get(third)).toBe(12);
  });

  it('AC-FLT-08 only planners read fuel', async () => {
    const as = async (role: UserRole, depotId?: string) =>
      (
        await signedInAs(app, db, {
          role,
          depotId: depotId ?? (role === 'admin' ? null : depot.plg),
        })
      ).cookie;
    const get = (cookie: string, id = vehicle) =>
      request(app.getHttpServer())
        .get(`/api/v1/vehicles/${id}/fuel?week=2026-W40`)
        .set('Cookie', cookie);

    for (const role of ['admin', 'dispatcher'] as const) {
      const res = await get(await as(role));
      expect(res.status).toBe(200);
      expect(bodyOf<{ data: FuelWeekDto }>(res).data).toMatchObject({
        vehicleId: vehicle,
        isoYear: 2026,
        isoWeek: 40,
        quotaL: 400,
        plannedL: 10,
        actualL: 0,
        leftL: 390,
      });
    }
    for (const role of ['loader', 'driver'] as const)
      expectProblem(await get(await as(role)), 'FORBIDDEN');
    expectProblem(
      await get(
        (
          await signedInAs(app, db, {
            role: 'store_manager',
            outletId: `OUT${sfx}`,
          })
        ).cookie,
      ),
      'FORBIDDEN',
    );

    // Out of a dispatcher's depot is 404, as for a vehicle that does not exist.
    const kandy = await as('dispatcher', depot.kdy);
    expectProblem(await get(kandy, vehicle), 'NOT_FOUND');
    expect((await get(kandy, kandyVehicle)).status).toBe(200);
    expectProblem(await get(await as('admin'), 'NO-SUCH'), 'NOT_FOUND');
  });

  it('refuses a week that is not YYYY-Www', async () => {
    const cookie = (await signedInAs(app, db, { role: 'admin' })).cookie;
    const res = await request(app.getHttpServer())
      .get(`/api/v1/vehicles/${vehicle}/fuel?week=40`)
      .set('Cookie', cookie);
    expectProblem(res, 'VALIDATION_FAILED');
  });
});
