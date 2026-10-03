/**
 * Proves what the database enforces on its own: row-level security by actor,
 * the append-only audit trail, and the composite keys and checks that keep a
 * plan legal. Needs a migrated database with the three roles:
 *
 *   TEST_DIRECT_URL=postgres://compass_owner:...@localhost:5432/waypoint \
 *   TEST_DATABASE_URL=postgres://compass_app:...@localhost:5432/waypoint \
 *   pnpm --filter api test -- database.spec
 *
 * Skipped when those variables are unset. Fixture ids carry a random suffix,
 * so the suite can run repeatedly against the same database.
 */
import { randomBytes } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { withActor, type Actor } from '../actor';
import { createDatabase, createPool, type Database } from '../client';
import {
  alerts,
  auditEvents,
  capacityPlans,
  deferralReasons,
  deferrals,
  depots,
  districts,
  items,
  orderLines,
  orders,
  outlets,
  plans,
  stops,
  trips,
  users,
  vehicles,
} from '../schema';

const OWNER_URL = process.env.TEST_DIRECT_URL;
const APP_URL = process.env.TEST_DATABASE_URL;
const suite = OWNER_URL && APP_URL ? describe : describe.skip;

/** The Postgres error code of a failed query (drizzle wraps it in `cause`). */
async function pgCode(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code;
  }
}

suite('database guarantees', () => {
  jest.setTimeout(30_000);

  const sfx = randomBytes(3).toString('hex');
  const ids = {
    plg: `P${sfx}`,
    kdy: `K${sfx}`,
    d1: `d1-${sfx}`,
    d2: `d2-${sfx}`,
    d3: `d3-${sfx}`,
    outletA: `OA-${sfx}`,
    outletB: `OB-${sfx}`,
    outletC: `OC-${sfx}`,
    vehicleP: `VP-${sfx}`,
    vehicleK: `VK-${sfx}`,
    storeManager: `sm-${sfx}`,
    driver: `drv-${sfx}`,
  };
  let owner: Database;
  let app: Database;
  let ownerPool: ReturnType<typeof createPool>;
  let appPool: ReturnType<typeof createPool>;
  let orderA: string, orderB: string, orderC: string, tripId: string;

  const visibleOrders = async (actor?: Actor) => {
    const q = (db: Pick<Database, 'select'>) =>
      db
        .select({ id: orders.id })
        .from(orders)
        .where(inArray(orders.id, [orderA, orderB, orderC]));
    const rows = actor ? await withActor(app, actor, q) : await q(app);
    return rows.map((r) => r.id).sort();
  };

  beforeAll(async () => {
    ownerPool = createPool(OWNER_URL!);
    appPool = createPool(APP_URL!);
    owner = createDatabase(ownerPool);
    app = createDatabase(appPool);

    await owner.transaction(async (tx) => {
      await tx.insert(depots).values([
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
      await tx.insert(districts).values([
        { id: ids.d1, name: `Gampaha ${sfx}`, depotId: ids.plg, ...travel },
        { id: ids.d2, name: `Colombo ${sfx}`, depotId: ids.plg, ...travel },
        { id: ids.d3, name: `Kandy ${sfx}`, depotId: ids.kdy, ...travel },
      ]);
      const outlet = {
        brand: 'FRESH' as const,
        dockType: 'REAR_DOCK' as const,
        parkingConstraint: 'NORMAL' as const,
        windowOpenMin: 330,
        windowCloseMin: 450,
      };
      await tx.insert(outlets).values([
        {
          id: ids.outletA,
          name: 'A',
          districtId: ids.d1,
          depotId: ids.plg,
          ...outlet,
        },
        {
          id: ids.outletB,
          name: 'B',
          districtId: ids.d2,
          depotId: ids.plg,
          ...outlet,
        },
        {
          id: ids.outletC,
          name: 'C',
          districtId: ids.d3,
          depotId: ids.kdy,
          ...outlet,
        },
      ]);
      const vehicle = {
        type: 'TRUCK' as const,
        temp: 'REEFER' as const,
        weightCapKg: 5000,
        volumeCapM3: 30,
        fuelType: 'diesel',
        kmPerL: 8,
        weeklyFuelQuotaL: 400,
      };
      await tx.insert(vehicles).values([
        {
          id: ids.vehicleP,
          code: `REF-${sfx}`,
          registrationNo: `WP ${sfx}-1`,
          depotId: ids.plg,
          ...vehicle,
        },
        {
          id: ids.vehicleK,
          code: `DRY-${sfx}`,
          registrationNo: `WP ${sfx}-2`,
          depotId: ids.kdy,
          ...vehicle,
        },
      ]);
      await tx.insert(users).values([
        {
          id: ids.storeManager,
          name: 'Store',
          email: `sm-${sfx}@test`,
          role: 'store_manager',
          outletId: ids.outletA,
        },
        {
          id: ids.driver,
          name: 'Driver',
          email: `drv-${sfx}@test`,
          role: 'driver',
          depotId: ids.plg,
        },
      ]);
      const order = {
        brand: 'FRESH' as const,
        tempClass: 'CHILLED' as const,
        requestedDate: '2026-10-01',
        deliveryDate: '2026-10-01',
        status: 'CONFIRMED' as const,
      };
      [{ id: orderA }, { id: orderB }, { id: orderC }] = await tx
        .insert(orders)
        .values([
          {
            orderNo: `T-${sfx}-A`,
            outletId: ids.outletA,
            depotId: ids.plg,
            districtId: ids.d1,
            ...order,
          },
          {
            orderNo: `T-${sfx}-B`,
            outletId: ids.outletB,
            depotId: ids.plg,
            districtId: ids.d2,
            ...order,
          },
          {
            orderNo: `T-${sfx}-C`,
            outletId: ids.outletC,
            depotId: ids.kdy,
            districtId: ids.d3,
            ...order,
          },
        ])
        .returning({ id: orders.id });
      const [item] = await tx
        .insert(items)
        .values({
          sku: `SKU-${sfx}`,
          name: 'Milk',
          brand: 'FRESH',
          category: 'Dairy',
          tempClass: 'CHILLED',
          packLabel: 'Crate of 12',
          unitWeightKg: 12,
          unitVolumeM3: 0.02,
        })
        .returning({ id: items.id });
      await tx.insert(orderLines).values({
        orderId: orderB,
        itemId: item.id,
        qty: 2,
        unitWeightKg: 12,
        unitVolumeM3: 0.02,
      });
      const [plan] = await tx
        .insert(plans)
        .values({ depotId: ids.plg, date: '2026-10-01' })
        .returning({ id: plans.id });
      [{ id: tripId }] = await tx
        .insert(trips)
        .values({
          planId: plan.id,
          depotId: ids.plg,
          vehicleId: ids.vehicleP,
          driverId: ids.driver,
          tripNo: 1,
          brand: 'FRESH',
          districtId: ids.d2,
          tempClass: 'CHILLED',
        })
        .returning({ id: trips.id });
      await tx.insert(stops).values({
        tripId,
        orderId: orderB,
        outletId: ids.outletB,
        depotId: ids.plg,
        brand: 'FRESH',
        districtId: ids.d2,
        seq: 1,
        plannedServiceMin: 15,
        windowOpenMin: 330,
        windowCloseMin: 450,
      });
    });
  });

  afterAll(async () => {
    await ownerPool?.end();
    await appPool?.end();
  });

  describe('row-level security on compass_app', () => {
    it('returns no rows when no actor is stamped (fail closed)', async () => {
      expect(await visibleOrders()).toEqual([]);
    });

    it("shows a store manager only their own outlet's orders", async () => {
      const actor: Actor = {
        id: ids.storeManager,
        role: 'store_manager',
        outletId: ids.outletA,
      };
      expect(await visibleOrders(actor)).toEqual([orderA]);
    });

    it('scopes dispatchers and loaders to their depot', async () => {
      const both = [orderA, orderB].sort();
      expect(
        await visibleOrders({ id: 'd', role: 'dispatcher', depotId: ids.plg }),
      ).toEqual(both);
      expect(await visibleOrders({ id: 'd', role: 'dispatcher' })).toEqual(
        [orderA, orderB, orderC].sort(),
      );
      expect(
        await visibleOrders({ id: 'l', role: 'loader', depotId: ids.kdy }),
      ).toEqual([orderC]);
    });

    it('shows a driver only the orders on their trips', async () => {
      expect(
        await visibleOrders({
          id: ids.driver,
          role: 'driver',
          depotId: ids.plg,
        }),
      ).toEqual([orderB]);
    });

    it('lets child rows follow their order', async () => {
      const lines = (actor: Actor) =>
        withActor(app, actor, (tx) =>
          tx
            .select({ id: orderLines.id })
            .from(orderLines)
            .where(inArray(orderLines.orderId, [orderB])),
        );
      expect(
        await lines({
          id: ids.storeManager,
          role: 'store_manager',
          outletId: ids.outletA,
        }),
      ).toHaveLength(0);
      expect(await lines({ id: ids.driver, role: 'driver' })).toHaveLength(1);
    });

    it("refuses a store manager writing another outlet's order", async () => {
      const code = await pgCode(
        withActor(
          app,
          {
            id: ids.storeManager,
            role: 'store_manager',
            outletId: ids.outletA,
          },
          (tx) =>
            tx.insert(orders).values({
              orderNo: `T-${sfx}-X`,
              outletId: ids.outletB,
              depotId: ids.plg,
              brand: 'FRESH',
              districtId: ids.d2,
              tempClass: 'AMBIENT',
              requestedDate: '2026-10-02',
              deliveryDate: '2026-10-02',
            }),
        ),
      );
      expect(code).toBe('42501'); // new row violates row-level security policy
    });
  });

  describe('append-only audit trail', () => {
    let auditId: string;

    beforeAll(async () => {
      [{ id: auditId }] = await app
        .insert(auditEvents)
        .values({
          source: 'SYSTEM',
          action: 'test.audit.written',
          entityType: 'order',
          entityId: orderA,
          occurredAt: new Date(),
          recordedAt: new Date(),
          prevHash: '',
          hash: `test-${sfx}`,
        })
        .returning({ id: auditEvents.id });
    });

    it('lets compass_app insert but not update or delete', async () => {
      expect(
        await pgCode(
          app.execute(
            sql`UPDATE audit_events SET action = 'x' WHERE id = ${auditId}`,
          ),
        ),
      ).toBe('42501');
      expect(
        await pgCode(
          app.execute(sql`DELETE FROM audit_events WHERE id = ${auditId}`),
        ),
      ).toBe('42501');
    });

    it('blocks UPDATE, DELETE and TRUNCATE even for the owner', async () => {
      const blocked = '23001'; // restrict_violation, raised by the trigger
      expect(
        await pgCode(
          owner.execute(
            sql`UPDATE audit_events SET action = 'x' WHERE id = ${auditId}`,
          ),
        ),
      ).toBe(blocked);
      expect(
        await pgCode(
          owner.execute(sql`DELETE FROM audit_events WHERE id = ${auditId}`),
        ),
      ).toBe(blocked);
      expect(await pgCode(owner.execute(sql`TRUNCATE audit_events`))).toBe(
        blocked,
      );
    });
  });

  describe('plan integrity', () => {
    const tripValues = () => ({
      depotId: ids.plg,
      brand: 'FRESH' as const,
      districtId: ids.d2,
      tempClass: 'CHILLED' as const,
    });
    const planId = async () =>
      (
        await owner
          .select({ id: trips.planId })
          .from(trips)
          .where(inArray(trips.id, [tripId]))
      )[0].id;

    it('refuses a trip on a vehicle from another depot', async () => {
      const code = await pgCode(
        owner.insert(trips).values({
          ...tripValues(),
          planId: await planId(),
          vehicleId: ids.vehicleK,
          tripNo: 2,
        }),
      );
      expect(code).toBe('23503');
    });

    it('allows two trips per vehicle per day, not three or a duplicate', async () => {
      const pid = await planId();
      expect(
        await pgCode(
          owner.insert(trips).values({
            ...tripValues(),
            planId: pid,
            vehicleId: ids.vehicleP,
            tripNo: 3,
          }),
        ),
      ).toBe('23514');
      expect(
        await pgCode(
          owner.insert(trips).values({
            ...tripValues(),
            planId: pid,
            vehicleId: ids.vehicleP,
            tripNo: 1,
          }),
        ),
      ).toBe('23505');
    });

    it("refuses a stop whose outlet is outside the trip's district", async () => {
      const code = await pgCode(
        owner.insert(stops).values({
          tripId,
          orderId: orderA,
          outletId: ids.outletA,
          depotId: ids.plg,
          brand: 'FRESH',
          districtId: ids.d2,
          seq: 2,
          plannedServiceMin: 15,
          windowOpenMin: 330,
          windowCloseMin: 450,
        }),
      );
      expect(code).toBe('23503');
    });

    it('keeps an order on one live stop', async () => {
      const code = await pgCode(
        owner.insert(stops).values({
          tripId,
          orderId: orderB,
          outletId: ids.outletB,
          depotId: ids.plg,
          brand: 'FRESH',
          districtId: ids.d2,
          seq: 2,
          plannedServiceMin: 15,
          windowOpenMin: 330,
          windowCloseMin: 450,
        }),
      );
      expect(code).toBe('23505');
    });

    it("refuses an order whose depot is not its outlet's", async () => {
      const code = await pgCode(
        owner.insert(orders).values({
          orderNo: `T-${sfx}-Y`,
          outletId: ids.outletA,
          depotId: ids.kdy,
          brand: 'FRESH',
          districtId: ids.d1,
          tempClass: 'AMBIENT',
          requestedDate: '2026-10-02',
          deliveryDate: '2026-10-02',
        }),
      );
      expect(code).toBe('23503');
    });

    it('keeps one unresolved alert per dedupe key', async () => {
      const alert = {
        type: 'LATE_RISK' as const,
        depotId: ids.plg,
        title: 'Late',
        dedupeKey: `LATE_RISK:stop:${sfx}`,
      };
      await owner.insert(alerts).values(alert);
      expect(await pgCode(owner.insert(alerts).values(alert))).toBe('23505');
      await owner.execute(
        sql`UPDATE alerts SET status = 'RESOLVED' WHERE "dedupeKey" = ${alert.dedupeKey}`,
      );
      expect(await pgCode(owner.insert(alerts).values(alert))).toBeUndefined();
    });

    it('refuses stop projections out of range', async () => {
      const update = (set: Partial<typeof stops.$inferInsert>) =>
        pgCode(owner.update(stops).set(set).where(eq(stops.tripId, tripId)));
      expect(await update({ lateRiskProb: 1.2 })).toBe('23514');
      expect(await update({ arrivedLat: 91, arrivedLng: 80 })).toBe('23514');
      expect(await update({ unitsDelivered: -1 })).toBe('23514');
      expect(
        await update({
          lateRiskProb: 0.4,
          arrivedLat: 6.97,
          arrivedLng: 79.92,
          unitsDelivered: 12,
        }),
      ).toBeUndefined();
    });

    it('keeps one live whole-order deferral per order and plan', async () => {
      const reasonCode = `OVER_CAPACITY_${sfx}`;
      await owner
        .insert(deferralReasons)
        .values({ code: reasonCode, label: 'Fleet full', fromEngine: true });
      const deferral = {
        orderId: orderA,
        planId: await planId(),
        source: 'ENGINE' as const,
        reasonCode,
        fromDate: '2026-10-01',
        toDate: '2026-10-02',
      };
      const [first] = await owner
        .insert(deferrals)
        .values({
          ...deferral,
          choice: 'UNAVOIDABLE',
          bindingRule: 'CAP_VOLUME',
        })
        .returning();
      expect(first).toMatchObject({
        choice: 'UNAVOIDABLE',
        bindingRule: 'CAP_VOLUME',
      });

      // A second PROPOSED or CONFIRMED one for the same order and plan is refused...
      expect(await pgCode(owner.insert(deferrals).values(deferral))).toBe(
        '23505',
      );
      expect(
        await pgCode(
          owner.insert(deferrals).values({ ...deferral, status: 'CONFIRMED' }),
        ),
      ).toBe('23505');
      // ...but partial deferrals from the dock, one per removed line, sit beside it.
      for (let i = 0; i < 2; i += 1)
        expect(
          await pgCode(
            owner.insert(deferrals).values({
              ...deferral,
              source: 'LOAD_CHECK',
              status: 'CONFIRMED',
              partial: true,
            }),
          ),
        ).toBeUndefined();
      // Once the first is cancelled, a new decision may take its place.
      await owner
        .update(deferrals)
        .set({ status: 'CANCELLED' })
        .where(eq(deferrals.id, first.id));
      expect(
        await pgCode(owner.insert(deferrals).values(deferral)),
      ).toBeUndefined();
    });

    it('keeps one capacity plan per depot and ISO week', async () => {
      const week = { depotId: ids.plg, isoYear: 2026, isoWeek: 41 };
      expect(
        await pgCode(
          owner.insert(capacityPlans).values({ ...week, vehiclesPlanned: -1 }),
        ),
      ).toBe('23514');
      await owner
        .insert(capacityPlans)
        .values({ ...week, vehiclesPlanned: 30, driversPlanned: 28 });
      expect(await pgCode(owner.insert(capacityPlans).values(week))).toBe(
        '23505',
      );
    });
  });
});
