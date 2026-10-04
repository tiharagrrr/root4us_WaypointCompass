import { and, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem } from '../../../../test/kernel';
import { JobContextRunner } from '../../../core/context/job-context';
import type { DeliveredEvent } from '../../../core/outbox/event-bus';
import { orders, plans, stops } from '../../../db/schema';
import { ORDER_EVENTS } from '../../ordering';
import type { UnplannedOrderDto } from '../dto/plan-actions.dto';
import type { PlanDto } from '../dto/plan.dto';
import {
  consumesStoreChange,
  StoreChangeListener,
} from '../services/store-change.listener';
import {
  buildWorld,
  call,
  data,
  DAY,
  depotDay,
  outboxOf,
  tearDown,
  type DepotDay,
  type World,
} from './planning.world';

const plan = async (w: World, day: DepotDay) =>
  data<PlanDto>(
    await call(w, 'dispatcher', 'get', `/depots/${day.depotId}/plans/${DAY}`),
  );

/** One trip on REF-07 carrying these orders, with the day's driver. */
async function draftWith(w: World, day: DepotDay, orderIds: string[]) {
  const p = await plan(w, day);
  const key = `${day.codes.ref07}#1`;
  const res = await call(w, 'dispatcher', 'post', `/plans/${p.id}/edits`, {
    version: p.version,
    body: {
      ops: [
        {
          op: 'ADD_TRIP',
          vehicleId: day.vehicles.ref07,
          tripNo: 1,
          brand: 'FRESH',
          districtId: day.districtId,
        },
        ...orderIds.map((orderId) => ({
          op: 'ASSIGN_ORDER',
          orderId,
          tripKey: key,
        })),
        { op: 'SET_DRIVER', tripKey: key, driverId: day.driverId },
      ],
    },
  });
  expect(res.status).toBe(200);
  return data<PlanDto>(res);
}

const orderRow = async (w: World, id: string) =>
  (await w.db.select().from(orders).where(eq(orders.id, id)))[0];

const liveStopsOf = async (w: World, orderId: string) =>
  w.db
    .select()
    .from(stops)
    .where(
      and(
        eq(stops.orderId, orderId),
        inArray(stops.status, ['PENDING', 'ARRIVED']),
      ),
    );

/** What the relay hands planning when ordering commits a store's change. */
const storeChange = (
  w: World,
  type: string,
  orderId: string,
  payload: Record<string, unknown> = {},
) => {
  const event: DeliveredEvent = {
    id: uuidv7(),
    type,
    aggregateType: 'order',
    aggregateId: orderId,
    depotId: null,
    outletIds: [],
    userIds: [],
    payload: { v: 1, orderId, ...payload },
    occurredAt: new Date(),
    correlationId: null,
  };
  return w.app
    .get(JobContextRunner)
    .run({ id: `test:store-change:${event.id}` }, () =>
      w.app.get(StoreChangeListener).handle(event),
    );
};

/**
 * ROO-35: a dispatcher drafts from open orders too, a store's change takes
 * its order back off the draft, and publishing confirms only what its own
 * plan carries or defers.
 */
describeWithDb('planning: drafting from open orders', () => {
  jest.setTimeout(120_000);
  let w: World;

  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(() => tearDown(w));

  it('shows open orders in the queue and keeps them open on a draft trip', async () => {
    const day = await depotDay(w, {
      open: { volumeM3: 1, status: 'SUBMITTED' },
      waiting: { volumeM3: 1, outlet: 1, status: 'SUBMITTED' },
    });
    const p = await draftWith(w, day, [day.orders.open]);

    // On the trip, and still the store's to change: a draft never moves an order's status.
    expect(await liveStopsOf(w, day.orders.open)).toHaveLength(1);
    expect((await orderRow(w, day.orders.open)).status).toBe('SUBMITTED');

    const unplanned = data<UnplannedOrderDto[]>(
      await call(w, 'dispatcher', 'get', `/plans/${p.id}/unplanned`),
    );
    expect(
      unplanned.find((u) => u.orderId === day.orders.waiting),
    ).toMatchObject({ orderStatus: 'SUBMITTED' });
  });

  it("a store's change takes the order off the draft, and a stale save is refused", async () => {
    const day = await depotDay(w, {
      open: { volumeM3: 1, status: 'SUBMITTED' },
      other: { volumeM3: 1, outlet: 1, status: 'SUBMITTED' },
    });
    const seen = await draftWith(w, day, [day.orders.open]);

    expect(
      await storeChange(w, ORDER_EVENTS.linesChanged, day.orders.open),
    ).toBe('removed');
    expect(await liveStopsOf(w, day.orders.open)).toEqual([]);
    expect(await orderRow(w, day.orders.open)).toMatchObject({
      status: 'SUBMITTED',
      activeStopId: null,
    });
    const [after] = await w.db
      .select()
      .from(plans)
      .where(eq(plans.id, seen.id));
    expect(after.version).toBe(seen.version + 1);
    const edited = await outboxOf(w, 'plan.edited', seen.id);
    expect(
      edited.some(
        (e) =>
          (e.payload as { cause?: string; orderId?: string }).cause ===
            'store_changed_order' &&
          (e.payload as { orderId?: string }).orderId === day.orders.open,
      ),
    ).toBe(true);

    // The dispatcher still on the old version: 412, so nothing stale is saved over it.
    const stale = await call(
      w,
      'dispatcher',
      'post',
      `/plans/${seen.id}/edits`,
      {
        version: seen.version,
        body: {
          ops: [
            {
              op: 'ASSIGN_ORDER',
              orderId: day.orders.other,
              tripKey: `${day.codes.ref07}#1`,
            },
          ],
        },
      },
    );
    expectProblem(stale, 'VERSION_MISMATCH');
    expect(stale.status).toBe(412);

    // A second delivery of the same change finds nothing left to remove.
    expect(
      await storeChange(w, ORDER_EVENTS.linesChanged, day.orders.open),
    ).toBe('not_on_a_draft');
  });

  it('a save that lands first is the one the store change is applied to', async () => {
    const day = await depotDay(w, {
      open: { volumeM3: 1, status: 'SUBMITTED' },
    });
    // The dispatcher's save commits before the relay delivers the change: the
    // listener locks the plan and reads the stop that save left, so it is the
    // current stop that comes off, whichever trip it is on by then.
    const p = await draftWith(w, day, [day.orders.open]);
    const [onTrip] = await liveStopsOf(w, day.orders.open);
    expect(onTrip).toBeDefined();
    expect(await storeChange(w, ORDER_EVENTS.cancelled, day.orders.open)).toBe(
      'removed',
    );
    expect(await liveStopsOf(w, day.orders.open)).toEqual([]);
    const [after] = await w.db.select().from(plans).where(eq(plans.id, p.id));
    expect(after.version).toBe(p.version + 1);
  });

  it("leaves the draft alone for the dispatcher's urgent flag or a note edit", async () => {
    const day = await depotDay(w, {
      open: { volumeM3: 1, status: 'SUBMITTED' },
    });
    await draftWith(w, day, [day.orders.open]);

    // Not a store change at all: the listener is not even asked.
    expect(consumesStoreChange(ORDER_EVENTS.priorityChanged)).toBe(false);
    // An update that kept the delivery date (a note) leaves the stop on its trip.
    expect(
      await storeChange(w, ORDER_EVENTS.updated, day.orders.open, {
        deliveryDate: DAY,
      }),
    ).toBe('unchanged');
    expect(await liveStopsOf(w, day.orders.open)).toHaveLength(1);
    // One that moved the order to another day takes it off this day's draft.
    expect(
      await storeChange(w, ORDER_EVENTS.updated, day.orders.open, {
        deliveryDate: '2026-10-03',
      }),
    ).toBe('removed');
  });

  it('publishing confirms only the open orders its own plan carries', async () => {
    const day = await depotDay(w, {
      carried: { volumeM3: 1, status: 'SUBMITTED' },
    });
    // Open orders that are not this plan's: another day at the same depot,
    // and the same day at another depot.
    const laterDay = await depotDay(w, {
      later: { volumeM3: 1, status: 'SUBMITTED' },
    });
    await w.db
      .update(orders)
      .set({ depotId: day.depotId, deliveryDate: '2026-10-03' })
      .where(eq(orders.id, laterDay.orders.later))
      .catch(() => undefined);
    const otherDepot = await depotDay(w, {
      elsewhere: { volumeM3: 1, status: 'SUBMITTED' },
    });

    const p = await draftWith(w, day, [day.orders.carried]);
    const res = await call(w, 'dispatcher', 'post', `/plans/${p.id}/publish`, {
      version: p.version,
    });
    expect(res.status).toBe(200);

    expect((await orderRow(w, day.orders.carried)).status).toBe('PLANNED');
    expect((await orderRow(w, laterDay.orders.later)).status).toBe('SUBMITTED');
    expect((await orderRow(w, otherDepot.orders.elsewhere)).status).toBe(
      'SUBMITTED',
    );
  });
});
