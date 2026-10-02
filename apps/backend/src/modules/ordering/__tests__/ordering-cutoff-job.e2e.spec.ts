import { TransactionHost } from '@nestjs-cls/transactional';
import { ClockService } from '../../../core/clock/clock.service';
import { JobContextRunner } from '../../../core/context/job-context';
import { CutoffReminderService } from '../services/cutoff-reminder.service';
import { describeWithDb } from '../../../../test/create-test-app';
import { outletFixture } from '../../../../test/fixtures';
import { expectProblem, freezeClock } from '../../../../test/kernel';
import { OrderLifecycleService } from '../services/order-lifecycle.service';
import { ORDER_AUDIT, ORDER_EVENTS } from '../ordering.constants';
import {
  auditRows,
  buildWorld,
  call,
  data,
  type OrderBody,
  orderRow,
  outboxRows,
  resetOrders,
  seedOrder,
  tearDownWorld,
  tick,
  type World,
} from './ordering.world';

const FRIDAY = '2026-10-02';
const SATURDAY = '2026-10-03';
const AT_1512 = '2026-10-01T15:12:00+05:30';
const AT_1530 = '2026-10-01T15:30:00+05:30';
const AT_1601 = '2026-10-01T16:01:00+05:30';

interface DaySummary {
  depotId: string;
  date: string;
  total: number;
  byStatus: Record<string, number>;
  byBrand: Record<string, number>;
  byClass: Record<string, number>;
  units: number;
  cutoff: {
    at: string;
    cutoffMin: number;
    passed: boolean;
    closed: boolean;
    minutesLeft: number;
  };
  _links: Record<string, { href: string }>;
}

/**
 * What the clock does on its own: the one-minute cutoff job, the 15:30
 * reminder, the day summary 01 and 03 open with, and the lifecycle moves
 * other modules make (AC-ORD-06, 24, 26, 35 and 36).
 */
describeWithDb('ordering cutoff job, day summary and lifecycle', () => {
  jest.setTimeout(120_000);

  let w: World;

  beforeAll(async () => {
    w = await buildWorld();
  });

  afterAll(async () => {
    freezeClock(w.app, AT_1512).reset();
    await tearDownWorld(w);
  });

  beforeEach(async () => {
    await resetOrders(w);
    freezeClock(w.app, AT_1512);
  });

  it("AC-ORD-06 the cutoff confirms the day's orders", async () => {
    // 57 submitted Peliyagoda orders for Friday, as a demo day holds.
    const ids: string[] = [];
    for (let i = 0; i < 57; i += 1) {
      const outletId = i % 2 === 0 ? w.outlets.kadawatha : w.outlets.otherFresh;
      const seeded = await seedOrder(w, {
        outletId,
        status: 'SUBMITTED',
        requestedDate: FRIDAY,
        // A real depot day reaches 57 orders across its outlets; here two
        // outlets stand in for them, so the rest are backorders of the same
        // run, which the one-per-outlet-date-class rule exempts.
        source: i < 2 ? 'seed' : 'backorder',
      });
      ids.push(seeded.id);
    }

    await tick(w, 'cutoff', AT_1601);

    const rows = await Promise.all(ids.map((id) => orderRow(w, id)));
    expect(rows.filter((r) => r.status === 'CONFIRMED')).toHaveLength(57);
    expect(rows.every((r) => r.confirmedAt !== null)).toBe(true);

    const closed = await outboxRows(
      w,
      ORDER_EVENTS.cutoffClosed,
      `${w.depot.plg}#${FRIDAY}`,
    );
    expect(closed).toHaveLength(1);
    expect(closed[0].payload).toMatchObject({
      depotId: w.depot.plg,
      deliveryDate: FRIDAY,
      confirmed: 57,
      closedBy: 'ticker',
    });

    // A second tick finds the day closed and announces nothing again.
    await tick(w, 'cutoff', AT_1601);
    expect(
      await outboxRows(
        w,
        ORDER_EVENTS.cutoffClosed,
        `${w.depot.plg}#${FRIDAY}`,
      ),
    ).toHaveLength(1);
  });

  it('AC-ORD-24 cutoff confirms only due orders', async () => {
    const due = [
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
    ];
    const draft = await seedOrder(w, {
      outletId: w.outlets.tech,
      status: 'DRAFT',
      requestedDate: FRIDAY,
      lines: [{ itemId: w.items.tech, qty: 1 }],
    });
    // Rolled to Saturday, so its own cutoff is a run later.
    const rolled = await seedOrder(w, {
      outletId: w.outlets.style,
      status: 'SUBMITTED',
      requestedDate: FRIDAY,
      deliveryDate: SATURDAY,
      afterCutoff: true,
      lines: [{ itemId: w.items.style, qty: 1 }],
    });

    await tick(w, 'cutoff', AT_1601);

    for (const order of due) {
      const row = await orderRow(w, order.id);
      expect(row.status).toBe('CONFIRMED');
      expect(row.confirmedAt).not.toBeNull();
      expect(await auditRows(w, ORDER_AUDIT.confirmed, order.id)).toHaveLength(
        1,
      );
    }
    expect((await orderRow(w, draft.id)).status).toBe('DRAFT');
    expect((await orderRow(w, rolled.id)).status).toBe('SUBMITTED');

    const closes = await auditRows(
      w,
      ORDER_AUDIT.cutoffClosed,
      `${w.depot.plg}#${FRIDAY}`,
    );
    expect(closes).toHaveLength(1);
    expect(closes[0].after).toMatchObject({
      depotId: w.depot.plg,
      deliveryDate: FRIDAY,
      confirmed: 2,
    });
  });

  it('AC-ORD-26 reminder at 15:30 for missing orders', async () => {
    // Fresh Kadawatha has nothing for Friday; the other Fresh outlet has sent
    // its order. A Style outlet served on Mondays stands beside them: its own
    // next run is Monday, so Friday's cutoff is nothing to do with it.
    const sent = await seedOrder(w, {
      outletId: w.outlets.otherFresh,
      status: 'SUBMITTED',
      requestedDate: FRIDAY,
    });
    expect(sent.id).toBeTruthy();
    const mondayStyle = await outletFixture(
      w.db,
      `OUTM${w.sfx}`,
      { depotId: w.depot.plg, districtId: w.depot.plgDistrict },
      { brand: 'STYLE', name: `Style Monday ${w.sfx}`, styleDeliveryDow: 0 },
    );

    // The sweep's own count is what the log line carries, so the criterion
    // reads it from the service rather than from a log spy.
    const reminded = await sweepReminders(w, AT_1530);
    expect(reminded).toBeGreaterThanOrEqual(1);

    // The sweep is global, so only this world's outlets are read back: the
    // other suites sharing this database have outlets of their own.
    const mine = new Set([...Object.values(w.outlets), mondayStyle]);
    const sent26 = (await outboxRows(w, ORDER_EVENTS.cutoffReminder)).filter(
      (r) => mine.has((r.payload as { outletId: string }).outletId),
    );
    const forFriday = sent26.filter(
      (r) => (r.payload as { deliveryDate: string }).deliveryDate === FRIDAY,
    );
    const outletIds = forFriday.map(
      (r) => (r.payload as { outletId: string }).outletId,
    );
    expect(outletIds).toContain(w.outlets.kadawatha);
    expect(outletIds).not.toContain(w.outlets.otherFresh);
    expect(outletIds.filter((id) => id === w.outlets.kadawatha)).toHaveLength(
      1,
    );
    // The Friday Style outlet is served on the very day closing, so it is
    // reminded; the Monday one is reminded about nothing today, because its
    // own cutoff falls on Saturday, not now (AC-ORD-37's rule, from the
    // reminder's side).
    expect(outletIds).toContain(w.outlets.style);
    expect(
      sent26.map((r) => (r.payload as { outletId: string }).outletId),
    ).not.toContain(mondayStyle);

    // A second sweep in the same minute reminds nobody twice.
    expect(await sweepReminders(w, AT_1530)).toBe(0);
    await tick(w, 'reminder', AT_1530);
    const again = (await outboxRows(w, ORDER_EVENTS.cutoffReminder)).filter(
      (r) =>
        (r.payload as { outletId: string }).outletId === w.outlets.kadawatha &&
        (r.payload as { deliveryDate: string }).deliveryDate === FRIDAY,
    );
    expect(again).toHaveLength(1);
  });

  it('AC-ORD-35 depot day summary (01, 03)', async () => {
    await seedOrder(w, {
      outletId: w.outlets.kadawatha,
      status: 'SUBMITTED',
      requestedDate: FRIDAY,
      lines: [{ itemId: w.items.dryA, qty: 2 }],
    });
    await seedOrder(w, {
      outletId: w.outlets.kadawatha,
      status: 'SUBMITTED',
      requestedDate: FRIDAY,
      tempClass: 'CHILLED',
      lines: [{ itemId: w.items.chilled, qty: 1 }],
    });
    await seedOrder(w, {
      outletId: w.outlets.style,
      status: 'CONFIRMED',
      requestedDate: FRIDAY,
      lines: [{ itemId: w.items.style, qty: 4 }],
    });
    await seedOrder(w, {
      outletId: w.outlets.tech,
      status: 'DRAFT',
      requestedDate: FRIDAY,
      lines: [{ itemId: w.items.tech, qty: 1 }],
    });

    const res = await call(
      w,
      'dispatcher',
      'get',
      `/depots/${w.depot.plg}/days/${FRIDAY}`,
    );

    expect(res.status).toBe(200);
    const day = data<DaySummary>(res);
    expect(day.total).toBe(4);
    expect(day.byStatus).toEqual({ SUBMITTED: 2, CONFIRMED: 1, DRAFT: 1 });
    expect(day.byBrand).toEqual({ FRESH: 2, STYLE: 1, TECH: 1 });
    expect(day.byClass).toEqual({ AMBIENT: 3, CHILLED: 1 });
    expect(day.units).toBe(8);
    expect(day.cutoff).toMatchObject({
      at: '2026-10-01T16:00:00+05:30',
      cutoffMin: 960,
      passed: false,
      closed: false,
      minutesLeft: 48,
    });

    await tick(w, 'cutoff', AT_1601);

    const after = data<DaySummary>(
      await call(
        w,
        'dispatcher',
        'get',
        `/depots/${w.depot.plg}/days/${FRIDAY}`,
      ),
    );
    expect(after.cutoff).toMatchObject({ passed: true, closed: true });
    expect(after.byStatus).toEqual({ CONFIRMED: 3, DRAFT: 1 });
  });

  it('AC-ORD-36 lifecycle moves check the machine', async () => {
    const submitted = await seedOrder(w, {
      outletId: w.outlets.kadawatha,
      status: 'SUBMITTED',
      requestedDate: FRIDAY,
    });
    const confirmed = await seedOrder(w, {
      outletId: w.outlets.otherFresh,
      status: 'CONFIRMED',
      requestedDate: FRIDAY,
    });
    const lifecycle = w.app.get(OrderLifecycleService);
    const jobs = w.app.get(JobContextRunner);
    const txHost = w.app.get<TransactionHost>(TransactionHost);

    // Planning calls markPlanned inside its own transaction; the refusal has
    // to come before anything is written, so its transaction rolls back.
    await expect(
      jobs.run({ id: 'test:plan-submitted' }, () =>
        txHost.withTransaction(() => lifecycle.markPlanned(submitted.id)),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT_STATE', status: 409 });

    expect(await orderRow(w, submitted.id)).toMatchObject({
      status: 'SUBMITTED',
      version: submitted.version,
    });
    expect(
      await auditRows(w, ORDER_AUDIT.statusChanged, submitted.id),
    ).toHaveLength(0);

    await jobs.run({ id: 'test:plan-confirmed' }, () =>
      txHost.withTransaction(() => lifecycle.markPlanned(confirmed.id)),
    );

    expect((await orderRow(w, confirmed.id)).status).toBe('PLANNED');
    expect(
      await auditRows(w, ORDER_AUDIT.statusChanged, confirmed.id),
    ).toHaveLength(1);
  });

  it('refuses close-cutoff outside demo mode', async () => {
    await seedOrder(w, {
      outletId: w.outlets.kadawatha,
      status: 'SUBMITTED',
      requestedDate: FRIDAY,
    });

    const res = await call(
      w,
      'dispatcher',
      'post',
      `/depots/${w.depot.plg}/days/${FRIDAY}/close-cutoff`,
    ).send({});

    expect(res.status).toBe(404);
    expectProblem(res, 'NOT_FOUND');
    const day = data<DaySummary>(
      await call(
        w,
        'dispatcher',
        'get',
        `/depots/${w.depot.plg}/days/${FRIDAY}`,
      ),
    );
    expect(day.byStatus).toEqual({ SUBMITTED: 1 });
    expect(
      await outboxRows(
        w,
        ORDER_EVENTS.cutoffClosed,
        `${w.depot.plg}#${FRIDAY}`,
      ),
    ).toHaveLength(0);
    expect(day._links.closeCutoff).toBeUndefined();
  });

  it('a submitted order keeps its submit-time totals through the cutoff', async () => {
    const order = await seedOrder(w, {
      outletId: w.outlets.kadawatha,
      status: 'SUBMITTED',
      requestedDate: FRIDAY,
      lines: [
        { itemId: w.items.dryA, qty: 2 },
        { itemId: w.items.dryB, qty: 1 },
      ],
    });

    await tick(w, 'cutoff', AT_1601);

    const read = data<OrderBody>(
      await call(w, 'dispatcher', 'get', `/orders/${order.id}`),
    );
    expect(read.status).toBe('CONFIRMED');
    expect(read.totals).toMatchObject({ units: 3, weightKg: 40 });
  });
});

/**
 * One reminder sweep, in a job context stamped as the system, returning how
 * many outlets it reminded. The tick handler discards that number; the
 * criterion wants it.
 */
async function sweepReminders(w: World, at: string): Promise<number> {
  const clock = w.app.get(ClockService);
  clock.freeze(at);
  const reminders = w.app.get(CutoffReminderService);
  return w.app
    .get(JobContextRunner)
    .run({ id: `test:reminder:${at}` }, () => reminders.remind(clock.now()));
}
