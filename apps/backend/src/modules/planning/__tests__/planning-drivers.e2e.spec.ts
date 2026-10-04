import { eq } from 'drizzle-orm';
import { describeWithDb } from '../../../../test/create-test-app';
import { freezeClock } from '../../../../test/kernel';
import { trips, users } from '../../../db/schema';
import type { PlanDto } from '../dto/plan.dto';
import {
  buildWorld,
  call,
  data,
  DAY,
  depotDay,
  OPEN,
  tearDown,
  type World,
} from './planning.world';

describeWithDb('planning: trip drivers (ROO-76)', () => {
  jest.setTimeout(120_000);
  let w: World;

  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(() => tearDown(w));
  afterEach(() => freezeClock(w.app, OPEN));

  it("AC-PLN-40 a trip takes its vehicle's driver", async () => {
    const day = await depotDay(w, {
      a: { volumeM3: 1 },
      b: { volumeM3: 1, outlet: 1 },
    });
    // The day's driver drives REF-07; REF-03 has no driver of its own.
    await w.db
      .update(users)
      .set({ defaultVehicleId: day.vehicles.ref07 })
      .where(eq(users.id, day.driverId));
    const trip = (vehicleId: string) => ({
      op: 'ADD_TRIP',
      vehicleId,
      tripNo: 1,
      brand: 'FRESH',
      districtId: day.districtId,
    });
    const p = data<PlanDto>(
      await call(w, 'dispatcher', 'get', `/depots/${day.depotId}/plans/${DAY}`),
    );

    const built = await call(w, 'dispatcher', 'post', `/plans/${p.id}/edits`, {
      version: p.version,
      key: crypto.randomUUID(),
      body: {
        ops: [
          trip(day.vehicles.ref07),
          trip(day.vehicles.ref03),
          {
            op: 'ASSIGN_ORDER',
            orderId: day.orders.a,
            tripKey: `${day.codes.ref07}#1`,
          },
          {
            op: 'ASSIGN_ORDER',
            orderId: day.orders.b,
            tripKey: `${day.codes.ref03}#1`,
          },
        ],
      },
    });
    expect(built.status).toBe(200);

    const rows = await w.db
      .select({ vehicleId: trips.vehicleId, driverId: trips.driverId })
      .from(trips)
      .where(eq(trips.planId, p.id));
    const driverOf = new Map(rows.map((r) => [r.vehicleId, r.driverId]));
    expect(driverOf.get(day.vehicles.ref07)).toBe(day.driverId);
    expect(driverOf.get(day.vehicles.ref03)).toBeNull();

    const preview = await call(
      w,
      'dispatcher',
      'get',
      `/plans/${p.id}/publish-preview`,
    );
    const blockers = (
      preview.body as {
        data: { blockers: { kind: string; tripKey?: string }[] };
      }
    ).data.blockers.filter((b) => b.kind === 'NO_DRIVER');
    expect(blockers.map((b) => b.tripKey)).toEqual([`${day.codes.ref03}#1`]);
  });
});
