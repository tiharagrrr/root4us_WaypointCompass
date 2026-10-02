// DEMO_MODE on, so the dispatcher's "close the cutoff now" route exists.
// AppConfig reads the environment when app.module.ts is imported, which is
// why this is the first line of the file (test/demo-mode.ts).
import '../../../../test/demo-mode';
import { describeWithDb } from '../../../../test/create-test-app';
import { freezeClock } from '../../../../test/kernel';
import { ORDER_EVENTS } from '../ordering.constants';
import {
  buildWorld,
  call,
  data,
  orderRow,
  outboxRows,
  resetOrders,
  seedOrder,
  tearDownWorld,
  tick,
  type World,
} from './ordering.world';

const FRIDAY = '2026-10-02';
const AT_1500 = '2026-10-01T15:00:00+05:30';
const AT_1601 = '2026-10-01T16:01:00+05:30';

interface CloseResult {
  depotId: string;
  date: string;
  confirmed: number;
  closed: boolean;
}

/**
 * AC-ORD-25: in demo mode a dispatcher closes the cutoff on the spot, so a
 * walkthrough does not have to wait for 16:00. The day is announced exactly
 * once, however many times the ticker reaches it afterwards. The other half
 * of the criterion, that the route does not exist with DEMO_MODE=false, is
 * in ordering-cutoff-job.e2e.spec.ts, which runs with demo mode off.
 */
describeWithDb('ordering demo cutoff close', () => {
  jest.setTimeout(60_000);

  let w: World;

  beforeAll(async () => {
    w = await buildWorld();
  });

  afterAll(async () => {
    freezeClock(w.app, AT_1500).reset();
    await tearDownWorld(w);
  });

  beforeEach(async () => {
    await resetOrders(w);
    freezeClock(w.app, AT_1500);
  });

  it('AC-ORD-25 close a cutoff in demo mode', async () => {
    const seeded = [
      await seedOrder(w, {
        outletId: w.outlets.kadawatha,
        status: 'SUBMITTED',
        requestedDate: FRIDAY,
      }),
      await seedOrder(w, {
        outletId: w.outlets.otherFresh,
        status: 'SUBMITTED',
        requestedDate: FRIDAY,
      }),
      await seedOrder(w, {
        outletId: w.outlets.style,
        status: 'SUBMITTED',
        requestedDate: FRIDAY,
        lines: [{ itemId: w.items.style, qty: 2 }],
      }),
    ];

    const res = await call(
      w,
      'dispatcher',
      'post',
      `/depots/${w.depot.plg}/days/${FRIDAY}/close-cutoff`,
    ).send({});

    expect(res.status).toBe(200);
    expect(data<CloseResult>(res)).toMatchObject({
      depotId: w.depot.plg,
      date: FRIDAY,
      confirmed: 3,
      closed: true,
    });
    for (const order of seeded)
      expect((await orderRow(w, order.id)).status).toBe('CONFIRMED');

    const aggregate = `${w.depot.plg}#${FRIDAY}`;
    expect(
      await outboxRows(w, ORDER_EVENTS.cutoffClosed, aggregate),
    ).toHaveLength(1);

    // The ticker reaches the same day once the clock passes 16:00 and finds
    // it closed, so nothing is announced twice.
    await tick(w, 'cutoff', AT_1601);
    expect(
      await outboxRows(w, ORDER_EVENTS.cutoffClosed, aggregate),
    ).toHaveLength(1);
  });

  it('offers the close link to a dispatcher and refuses a store manager', async () => {
    await seedOrder(w, {
      outletId: w.outlets.kadawatha,
      status: 'SUBMITTED',
      requestedDate: FRIDAY,
    });

    const day = await call(
      w,
      'dispatcher',
      'get',
      `/depots/${w.depot.plg}/days/${FRIDAY}`,
    );
    expect(
      (day.body as { data: { _links: Record<string, unknown> } }).data._links
        .closeCutoff,
    ).toMatchObject({ method: 'POST' });

    // order:queue is the dispatcher's, so the store manager is refused
    // before the route runs (AC-ORD-34).
    const refused = await call(
      w,
      'store',
      'post',
      `/depots/${w.depot.plg}/days/${FRIDAY}/close-cutoff`,
    ).send({});
    expect(refused.status).toBe(403);
  });
});
