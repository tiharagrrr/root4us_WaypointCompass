import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem, freezeClock } from '../../../../test/kernel';
import { ORDER_AUDIT, ORDER_EVENTS } from '../ordering.constants';
import {
  auditRows,
  buildWorld,
  call,
  data,
  lineRows,
  type LinesBody,
  type OrderBody,
  orderRow,
  outboxRows,
  ownOrderCount,
  resetOrders,
  seedOrder,
  tearDownWorld,
  type World,
  write,
} from './ordering.world';

/** 15:00 on Thursday 1 October 2026, well before the 16:00 cutoff. */
const BEFORE_CUTOFF = '2026-10-01T15:00:00+05:30';
const FRIDAY = '2026-10-02';

/**
 * A draft order and its lines: how M1 builds an order before it is sent, and
 * what it refuses. The criteria come from specs/ordering/spec.md.
 */
describeWithDb('ordering drafts and lines', () => {
  jest.setTimeout(60_000);

  let w: World;

  beforeAll(async () => {
    w = await buildWorld();
  });

  afterAll(async () => {
    freezeClock(w.app, BEFORE_CUTOFF).reset();
    await tearDownWorld(w);
  });

  beforeEach(async () => {
    await resetOrders(w);
    freezeClock(w.app, BEFORE_CUTOFF);
  });

  /** A dry draft for Friday with the lines a criterion asks for. */
  const draft = async (
    lines: { itemId: string; qty: number }[] = [
      { itemId: w.items.dryA, qty: 2 },
    ],
    body: Record<string, unknown> = {},
  ): Promise<OrderBody> => {
    const res = await call(w, 'store', 'post', '/orders').send({
      tempClass: 'AMBIENT',
      requestedDate: FRIDAY,
      lines,
      ...body,
    });
    expect(res.status).toBe(201);
    return data<OrderBody>(res);
  };

  it('AC-ORD-09 create a draft order', async () => {
    const res = await call(w, 'store', 'post', '/orders')
      .set('Idempotency-Key', `create-${w.sfx}`)
      .send({
        tempClass: 'AMBIENT',
        requestedDate: FRIDAY,
        lines: [
          { itemId: w.items.dryA, qty: 2 },
          { itemId: w.items.dryB, qty: 1 },
        ],
      });

    expect(res.status).toBe(201);
    const order = data<OrderBody>(res);
    expect(res.headers.location).toBe(`/api/v1/orders/${order.id}`);
    expect(res.headers.etag).toBe('W/"1"');
    expect(order).toMatchObject({
      status: 'DRAFT',
      tempClass: 'AMBIENT',
      brand: 'FRESH',
      requestedDate: FRIDAY,
      deliveryDate: FRIDAY,
      afterCutoff: false,
      version: 1,
      editableUntil: '2026-10-01T16:00:00+05:30',
    });
    expect(order.orderNo).toMatch(/^WF-\d{4,}$/);
    expect(order.outlet.id).toBe(w.outlets.kadawatha);
    // The outlet's receiving window, 07:00 to 09:00, as M1's card shows it.
    expect(order.deliveryWindow).toEqual({
      openMin: 420,
      open: '07:00',
      closeMin: 540,
      close: '09:00',
    });
    expect(Object.keys(order._links)).toEqual(
      expect.arrayContaining(['self', 'lines', 'timeline', 'submit']),
    );

    const row = await orderRow(w, order.id);
    expect(row).toMatchObject({
      outletId: w.outlets.kadawatha,
      depotId: w.depot.plg,
      brand: 'FRESH',
      districtId: w.depot.plgDistrict,
      source: 'web',
      placedById: w.as.store.id,
    });
    expect(await auditRows(w, ORDER_AUDIT.created, order.id)).toHaveLength(1);
  });

  it('AC-ORD-10 outlet from scope, whole packs', async () => {
    const withOutlet = await call(w, 'store', 'post', '/orders').send({
      tempClass: 'AMBIENT',
      requestedDate: FRIDAY,
      outletId: w.outlets.otherFresh,
      lines: [{ itemId: w.items.dryA, qty: 2 }],
    });

    expect(withOutlet.status).toBe(400);
    const problem = expectProblem(withOutlet, 'VALIDATION_FAILED');
    expect(problem.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'outletId' })]),
    );
    expect(await countOrders(w)).toBe(0);

    const zeroQty = await call(w, 'store', 'post', '/orders').send({
      tempClass: 'AMBIENT',
      requestedDate: FRIDAY,
      lines: [{ itemId: w.items.dryA, qty: 0 }],
    });

    expect(zeroQty.status).toBe(400);
    expect(expectProblem(zeroQty, 'VALIDATION_FAILED').errors).toEqual(
      expect.arrayContaining([
        { field: 'lines[0].qty', code: 'min', message: 'Enter at least 1' },
      ]),
    );
    expect(await countOrders(w)).toBe(0);
  });

  it('AC-ORD-04 one order per outlet, date and class', async () => {
    const first = await draft();

    const second = await call(w, 'store', 'post', '/orders').send({
      tempClass: 'AMBIENT',
      requestedDate: FRIDAY,
      lines: [{ itemId: w.items.dryB, qty: 1 }],
    });

    expect(second.status).toBe(409);
    const problem = expectProblem(second, 'CONFLICT_STATE');
    expect(problem._links).toMatchObject({
      existing: { href: `/api/v1/orders/${first.id}` },
    });
    expect(await countOrders(w)).toBe(1);
  });

  it('AC-ORD-05 chilled items stay in chilled orders', async () => {
    const order = await draft();

    const res = await write(
      w,
      'store',
      'post',
      `/orders/${order.id}/lines`,
      order.version,
    ).send({ itemId: w.items.chilled, qty: 1 });

    expect(res.status).toBe(400);
    expect(expectProblem(res, 'VALIDATION_FAILED').errors).toEqual([
      {
        field: 'itemId',
        code: 'wrong_class',
        message: 'Add chilled items to a chilled order',
      },
    ]);
    expect((await orderRow(w, order.id)).version).toBe(1);
  });

  it('AC-ORD-11 only Fresh outlets order chilled', async () => {
    for (const role of ['styleStore', 'techStore'] as const) {
      const res = await call(w, role, 'post', '/orders').send({
        tempClass: 'CHILLED',
        requestedDate: FRIDAY,
        lines: [{ itemId: w.items.chilled, qty: 1 }],
      });

      expect(res.status).toBe(400);
      expect(expectProblem(res, 'VALIDATION_FAILED').errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'tempClass' }),
        ]),
      );
    }
    expect(await countOrders(w)).toBe(0);
  });

  it('AC-ORD-12 lines match brand; inactive items refused', async () => {
    const order = await draft();

    const wrongBrand = await write(
      w,
      'store',
      'post',
      `/orders/${order.id}/lines`,
      1,
    ).send({ itemId: w.items.style, qty: 1 });

    expect(wrongBrand.status).toBe(400);
    expect(expectProblem(wrongBrand, 'VALIDATION_FAILED').errors).toEqual([
      expect.objectContaining({ field: 'itemId', code: 'wrong_brand' }),
    ]);
    expect((await orderRow(w, order.id)).version).toBe(1);

    const retired = await write(
      w,
      'store',
      'post',
      `/orders/${order.id}/lines`,
      1,
    ).send({ itemId: w.items.retired, qty: 1 });

    expect(retired.status).toBe(400);
    expect(expectProblem(retired, 'VALIDATION_FAILED').errors).toEqual([
      expect.objectContaining({ field: 'itemId', code: 'inactive' }),
    ]);
    expect((await orderRow(w, order.id)).version).toBe(1);
  });

  it('AC-ORD-13 totals follow every line change', async () => {
    // Rice is 10 kg and 0.02 m³ a pack, flour 20 kg and 0.03 m³, sugar 5 kg
    // and 0.01 m³, so every total below is exact.
    const order = await draft([
      { itemId: w.items.dryA, qty: 2 },
      { itemId: w.items.dryB, qty: 1 },
    ]);
    expect(order.totals).toEqual({
      lines: 2,
      units: 3,
      weightKg: 40,
      volumeM3: 0.07,
      valueLkr: null,
    });

    const replaced = data<OrderBody>(
      await write(w, 'store', 'put', `/orders/${order.id}/lines`, 1).send({
        lines: [
          { itemId: w.items.dryA, qty: 3 },
          { itemId: w.items.dryC, qty: 4 },
        ],
      }),
    );
    expect(replaced.version).toBe(2);
    expect(replaced.totals).toEqual({
      lines: 2,
      units: 7,
      weightKg: 50,
      volumeM3: 0.1,
      valueLkr: null,
    });

    // Each line stores the item's size as a snapshot of its own.
    const stored = await lineRows(w, order.id);
    expect(stored).toHaveLength(2);
    expect(stored.map((l) => [l.unitWeightKg, l.unitVolumeM3]).sort()).toEqual(
      [
        [10, 0.02],
        [5, 0.01],
      ].sort(),
    );

    const added = data<OrderBody>(
      await write(w, 'store', 'post', `/orders/${order.id}/lines`, 2).send({
        itemId: w.items.dryB,
        qty: 1,
      }),
    );
    expect(added.version).toBe(3);
    expect(added.totals).toMatchObject({ lines: 3, units: 8, weightKg: 70 });

    const lines = data<LinesBody>(
      await call(w, 'store', 'get', `/orders/${order.id}/lines`),
    );
    const sugar = lines.lines.find((l) => l.itemId === w.items.dryC)!;
    const patched = data<OrderBody>(
      await write(
        w,
        'store',
        'patch',
        `/orders/${order.id}/lines/${sugar.id}`,
        3,
      ).send({ qty: 2 }),
    );
    expect(patched.version).toBe(4);
    expect(patched.totals).toMatchObject({ lines: 3, units: 6, weightKg: 60 });

    const removed = data<OrderBody>(
      await write(
        w,
        'store',
        'delete',
        `/orders/${order.id}/lines/${sugar.id}`,
        4,
      ),
    );
    expect(removed.version).toBe(5);
    expect(removed.totals).toMatchObject({ lines: 2, units: 4, weightKg: 50 });
  });

  it('AC-ORD-13 a Tech order carries value', async () => {
    const res = await call(w, 'techStore', 'post', '/orders').send({
      tempClass: 'AMBIENT',
      requestedDate: FRIDAY,
      lines: [{ itemId: w.items.tech, qty: 3 }],
    });

    expect(res.status).toBe(201);
    // The router is 1 000 LKR a pack, so three packs are 3 000.
    expect(data<OrderBody>(res).totals).toMatchObject({ valueLkr: 3000 });
  });

  it('AC-ORD-14 versioned writes need current If-Match', async () => {
    const order = await draft([{ itemId: w.items.dryA, qty: 2 }]);
    await write(w, 'store', 'post', `/orders/${order.id}/lines`, 1).send({
      itemId: w.items.dryB,
      qty: 1,
    });
    expect((await orderRow(w, order.id)).version).toBe(2);

    const missing = await call(
      w,
      'store',
      'put',
      `/orders/${order.id}/lines`,
    ).send({ lines: [{ itemId: w.items.dryC, qty: 9 }] });

    expect(missing.status).toBe(428);
    expectProblem(missing, 'PRECONDITION_REQUIRED');
    expect((await orderRow(w, order.id)).version).toBe(2);

    const stale = await write(
      w,
      'store',
      'put',
      `/orders/${order.id}/lines`,
      1,
    ).send({ lines: [{ itemId: w.items.dryC, qty: 9 }] });

    expect(stale.status).toBe(412);
    expectProblem(stale, 'VERSION_MISMATCH');
    const row = await orderRow(w, order.id);
    expect(row.version).toBe(2);
    expect(await lineRows(w, order.id)).toHaveLength(2);
  });

  it('AC-ORD-16 submit needs lines and a draft', async () => {
    const empty = await call(w, 'store', 'post', '/orders').send({
      tempClass: 'AMBIENT',
      requestedDate: FRIDAY,
    });
    expect(empty.status).toBe(201);
    const order = data<OrderBody>(empty);

    const res = await write(
      w,
      'store',
      'post',
      `/orders/${order.id}/submit`,
      1,
    ).send({});

    expect(res.status).toBe(400);
    expect(expectProblem(res, 'VALIDATION_FAILED').errors).toEqual([
      { field: 'lines', code: 'min', message: 'Add at least one item' },
    ]);
    expect((await orderRow(w, order.id)).status).toBe('DRAFT');
    expect(await auditRows(w, ORDER_AUDIT.submitted, order.id)).toHaveLength(0);
    expect(await outboxRows(w, ORDER_EVENTS.submitted, order.id)).toHaveLength(
      0,
    );

    for (const status of ['SUBMITTED', 'CONFIRMED', 'CANCELLED'] as const) {
      await resetOrders(w);
      const seeded = await seedOrder(w, {
        outletId: w.outlets.kadawatha,
        status,
      });
      const again = await write(
        w,
        'store',
        'post',
        `/orders/${seeded.id}/submit`,
        seeded.version,
      ).send({});

      expect(again.status).toBe(409);
      expectProblem(again, 'CONFLICT_STATE');
      expect((await orderRow(w, seeded.id)).status).toBe(status);
    }
  });

  it('AC-ORD-18 only drafts can be deleted', async () => {
    const order = await draft();

    const gone = await write(w, 'store', 'delete', `/orders/${order.id}`, 1);

    expect(gone.status).toBe(204);
    expect(await orderRow(w, order.id)).toBeUndefined();
    expect(await auditRows(w, ORDER_AUDIT.deleted, order.id)).toHaveLength(1);

    const sent = await seedOrder(w, {
      outletId: w.outlets.kadawatha,
      status: 'SUBMITTED',
    });
    const refused = await write(
      w,
      'store',
      'delete',
      `/orders/${sent.id}`,
      sent.version,
    );

    expect(refused.status).toBe(409);
    expectProblem(refused, 'CONFLICT_STATE');
    expect((await orderRow(w, sent.id)).status).toBe('SUBMITTED');
  });

  it('refuses a second line for an item already on the order', async () => {
    const order = await draft([{ itemId: w.items.dryA, qty: 2 }]);

    const res = await write(
      w,
      'store',
      'post',
      `/orders/${order.id}/lines`,
      1,
    ).send({ itemId: w.items.dryA, qty: 1 });

    expect(res.status).toBe(409);
    expectProblem(res, 'CONFLICT_STATE');
    expect(await lineRows(w, order.id)).toHaveLength(1);
  });
});

/** How many orders the world's own outlets hold right now. */
async function countOrders(w: World): Promise<number> {
  return ownOrderCount(w);
}
