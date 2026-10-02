import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem, freezeClock } from '../../../../test/kernel';
import {
  ORDER_AUDIT,
  ORDER_EVENTS,
  ORDER_NOTICES,
} from '../ordering.constants';
import {
  auditRows,
  buildWorld,
  call,
  data,
  type LinesBody,
  notices,
  type OrderBody,
  orderRow,
  outboxRows,
  resetOrders,
  seedOrder,
  setDepotCutoffMin,
  tearDownWorld,
  type World,
  write,
} from './ordering.world';

const FRIDAY = '2026-10-02';
const SATURDAY = '2026-10-03';
/** One minute before the 16:00 cutoff on Thursday 1 October 2026. */
const AT_1559 = '2026-10-01T15:59:00+05:30';
const AT_1600 = '2026-10-01T16:00:00+05:30';
const AT_1540 = '2026-10-01T15:40:00+05:30';
const AT_1500 = '2026-10-01T15:00:00+05:30';

/**
 * Sending an order, and what the cutoff does to it: the roll to the next run,
 * the lock on edits, the depot override and the Style weekly delivery day
 * (specs/ordering/spec.md, AC-ORD-01 to 03, 08, 15, 17, 23 and 37).
 */
describeWithDb('ordering submit and the cutoff', () => {
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
    await setDepotCutoffMin(w, w.depot.kdy, null);
    freezeClock(w.app, AT_1500);
  });

  /** A dry draft for Friday holding three lines, as M1 leaves it. */
  const threeLineDraft = async (
    role: 'store' | 'kandyStore' = 'store',
  ): Promise<OrderBody> => {
    const res = await call(w, role, 'post', '/orders').send({
      tempClass: 'AMBIENT',
      requestedDate: FRIDAY,
      lines: [
        { itemId: w.items.dryA, qty: 2 },
        { itemId: w.items.dryB, qty: 1 },
        { itemId: w.items.dryC, qty: 4 },
      ],
    });
    expect(res.status).toBe(201);
    return data<OrderBody>(res);
  };

  it('AC-ORD-01 submit before the cutoff', async () => {
    const draft = await threeLineDraft();
    freezeClock(w.app, AT_1559);

    const res = await write(
      w,
      'store',
      'post',
      `/orders/${draft.id}/submit`,
      draft.version,
    ).send({});

    expect(res.status).toBe(200);
    const order = data<OrderBody>(res);
    expect(order).toMatchObject({
      status: 'SUBMITTED',
      afterCutoff: false,
      deliveryDate: FRIDAY,
    });
    expect(order._links.edit).toMatchObject({ method: 'PATCH' });
    expect(order._links.cancel).toMatchObject({ method: 'POST' });
    expect(order._links.submit).toBeUndefined();

    expect(await auditRows(w, ORDER_AUDIT.submitted, draft.id)).toHaveLength(1);
    const events = await outboxRows(w, ORDER_EVENTS.submitted, draft.id);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({
      v: 1,
      orderId: draft.id,
      outletId: w.outlets.kadawatha,
      afterCutoff: false,
      deliveryDate: FRIDAY,
    });
    expect(events[0].depotId).toBe(w.depot.plg);
    expect(events[0].outletIds).toEqual([w.outlets.kadawatha]);
  });

  it('AC-ORD-02 a late order rolls to the next run', async () => {
    const draft = await threeLineDraft();
    freezeClock(w.app, AT_1600);

    const res = await write(
      w,
      'store',
      'post',
      `/orders/${draft.id}/submit`,
      draft.version,
    ).send({});

    expect(res.status).toBe(200);
    expect(data<OrderBody>(res)).toMatchObject({
      status: 'SUBMITTED',
      afterCutoff: true,
      deliveryDate: SATURDAY,
    });
    expect(notices(res).map((n) => n.code)).toContain(
      ORDER_NOTICES.rolledToNextRun,
    );

    const rolled = await outboxRows(w, ORDER_EVENTS.rolledToNextRun, draft.id);
    expect(rolled).toHaveLength(1);
    expect(rolled[0].payload).toMatchObject({
      deliveryDate: SATURDAY,
      reason: 'AFTER_CUTOFF',
    });
    // The submit itself is announced too, with afterCutoff true.
    const submitted = await outboxRows(w, ORDER_EVENTS.submitted, draft.id);
    expect(submitted).toHaveLength(1);
    expect(submitted[0].payload).toMatchObject({ afterCutoff: true });
  });

  it('AC-ORD-03 edits lock at the cutoff', async () => {
    const order = await seedOrder(w, {
      outletId: w.outlets.kadawatha,
      status: 'SUBMITTED',
      requestedDate: FRIDAY,
      lines: [{ itemId: w.items.dryA, qty: 2 }],
    });
    const lines = data<LinesBody>(
      await call(w, 'store', 'get', `/orders/${order.id}/lines`),
    );
    freezeClock(w.app, AT_1600);

    const res = await write(
      w,
      'store',
      'patch',
      `/orders/${order.id}/lines/${lines.lines[0].id}`,
      order.version,
    ).send({ qty: 9 });

    expect(res.status).toBe(409);
    expectProblem(res, 'CUTOFF_PASSED');
    const row = await orderRow(w, order.id);
    expect(row).toMatchObject({ version: order.version, units: 2 });

    const read = data<OrderBody>(
      await call(w, 'store', 'get', `/orders/${order.id}`),
    );
    expect(read._links.edit).toBeUndefined();
    expect(read._links.cancel).toBeUndefined();
  });

  it('AC-ORD-15 submitted orders stay editable until cutoff', async () => {
    const seeded = await seedOrder(w, {
      outletId: w.outlets.kadawatha,
      status: 'SUBMITTED',
      requestedDate: FRIDAY,
      lines: [
        { itemId: w.items.dryA, qty: 2 },
        { itemId: w.items.dryB, qty: 1 },
      ],
    });
    // Two line writes take the seeded order to version 3, as the criterion asks.
    freezeClock(w.app, AT_1500);
    await write(w, 'store', 'post', `/orders/${seeded.id}/lines`, 1).send({
      itemId: w.items.dryC,
      qty: 1,
    });
    const atThree = data<OrderBody>(
      await write(w, 'store', 'put', `/orders/${seeded.id}/lines`, 2).send({
        lines: [
          { itemId: w.items.dryA, qty: 2 },
          { itemId: w.items.dryB, qty: 1 },
        ],
      }),
    );
    expect(atThree.version).toBe(3);

    freezeClock(w.app, AT_1540);
    const read = data<OrderBody>(
      await call(w, 'store', 'get', `/orders/${seeded.id}`),
    );
    expect(read.editableUntil).toBe('2026-10-01T16:00:00+05:30');
    expect(read._links.edit).toMatchObject({ requires: ['If-Match'] });
    expect(read._links.cancel?.requires).toEqual(
      expect.arrayContaining(['If-Match', 'reasonNote']),
    );
    expect(read._links.submit).toBeUndefined();

    const lines = data<LinesBody>(
      await call(w, 'store', 'get', `/orders/${seeded.id}/lines`),
    );
    const rice = lines.lines.find((l) => l.itemId === w.items.dryA)!;
    const changed = data<OrderBody>(
      await write(
        w,
        'store',
        'patch',
        `/orders/${seeded.id}/lines/${rice.id}`,
        3,
      ).send({ qty: 5 }),
    );

    expect(changed).toMatchObject({ status: 'SUBMITTED', version: 4 });
    // Five packs of rice at 10 kg plus one of flour at 20 kg.
    expect(changed.totals).toMatchObject({ units: 6, weightKg: 70 });

    const audits = await auditRows(w, ORDER_AUDIT.linesChanged, seeded.id);
    const last = audits.at(-1)!;
    expect(last.before).toMatchObject({ units: 3 });
    expect(last.after).toMatchObject({ units: 6 });
  });

  it('AC-ORD-17 replays apply once', async () => {
    const key = `create-${w.sfx}-17`;
    const body = {
      tempClass: 'AMBIENT',
      requestedDate: FRIDAY,
      lines: [{ itemId: w.items.dryA, qty: 2 }],
    };

    const first = await call(w, 'store', 'post', '/orders')
      .set('Idempotency-Key', key)
      .send(body);
    const second = await call(w, 'store', 'post', '/orders')
      .set('Idempotency-Key', key)
      .send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(data<OrderBody>(second).id).toBe(data<OrderBody>(first).id);
    expect(second.headers['idempotent-replayed']).toBe('true');

    const reused = await call(w, 'store', 'post', '/orders')
      .set('Idempotency-Key', key)
      .send({ ...body, note: 'different' });

    expect(reused.status).toBe(422);
    expectProblem(reused, 'IDEMPOTENCY_KEY_REUSED');

    const order = data<OrderBody>(first);
    const submitKey = `submit-${w.sfx}-17`;
    const submit = () =>
      write(w, 'store', 'post', `/orders/${order.id}/submit`, 1)
        .set('Idempotency-Key', submitKey)
        .send({});
    expect((await submit()).status).toBe(200);
    expect((await submit()).status).toBe(200);

    expect(await auditRows(w, ORDER_AUDIT.submitted, order.id)).toHaveLength(1);
    const events = await outboxRows(w, ORDER_EVENTS.submitted, order.id);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({
      v: 1,
      orderId: order.id,
      outletId: w.outlets.kadawatha,
      afterCutoff: false,
      deliveryDate: FRIDAY,
    });
    expect(events[0].depotId).toBe(w.depot.plg);
    expect(events[0].outletIds).toEqual([w.outlets.kadawatha]);
  });

  it('AC-ORD-08 style orders only for the delivery day', async () => {
    // The Style outlet takes deliveries on Friday (styleDeliveryDow 4), and
    // 2026-10-01 is a Thursday.
    const res = await call(w, 'styleStore', 'post', '/orders').send({
      tempClass: 'AMBIENT',
      requestedDate: '2026-10-01',
      lines: [{ itemId: w.items.style, qty: 2 }],
    });

    expect(res.status).toBe(400);
    const problem = expectProblem(res, 'VALIDATION_FAILED');
    expect(problem.errors).toEqual([
      expect.objectContaining({ field: 'requestedDate' }),
    ]);
    expect((problem.errors as { message: string }[])[0].message).toContain(
      'Friday',
    );
    const mine = await call(
      w,
      'styleStore',
      'get',
      `/orders?filter[outletId]=${w.outlets.style}`,
    );
    expect((mine.body as { data: unknown[] }).data).toHaveLength(0);
  });

  it("AC-ORD-37 a style order's run is its outlet's weekly delivery day", async () => {
    const draft = data<OrderBody>(
      await call(w, 'styleStore', 'post', '/orders').send({
        tempClass: 'AMBIENT',
        requestedDate: FRIDAY,
        lines: [{ itemId: w.items.style, qty: 2 }],
      }),
    );
    expect(draft.deliveryDate).toBe(FRIDAY);

    freezeClock(w.app, AT_1600);
    const late = data<OrderBody>(
      await write(
        w,
        'styleStore',
        'post',
        `/orders/${draft.id}/submit`,
        draft.version,
      ).send({}),
    );

    // Not the next operating day (Saturday) but the next Friday, because that
    // is the only day this outlet is served (specs/engine/rules.md §9).
    expect(late).toMatchObject({
      status: 'SUBMITTED',
      afterCutoff: true,
      deliveryDate: '2026-10-09',
    });
    const rolled = await outboxRows(w, ORDER_EVENTS.rolledToNextRun, draft.id);
    expect(rolled).toHaveLength(1);
    expect(rolled[0].payload).toMatchObject({ deliveryDate: '2026-10-09' });
  });

  it('AC-ORD-23 depot override moves the cutoff', async () => {
    // Kandy closes at 15:00; Peliyagoda keeps 16:00.
    await setDepotCutoffMin(w, w.depot.kdy, 900);
    const kandy = await threeLineDraft('kandyStore');
    const peliyagoda = await threeLineDraft('store');
    freezeClock(w.app, AT_1500);

    const kandySent = data<OrderBody>(
      await write(
        w,
        'kandyStore',
        'post',
        `/orders/${kandy.id}/submit`,
        kandy.version,
      ).send({}),
    );
    const plgSent = data<OrderBody>(
      await write(
        w,
        'store',
        'post',
        `/orders/${peliyagoda.id}/submit`,
        peliyagoda.version,
      ).send({}),
    );

    expect(kandySent).toMatchObject({
      status: 'SUBMITTED',
      afterCutoff: true,
      deliveryDate: SATURDAY,
    });
    expect(plgSent).toMatchObject({
      status: 'SUBMITTED',
      afterCutoff: false,
      deliveryDate: FRIDAY,
    });
  });
});
