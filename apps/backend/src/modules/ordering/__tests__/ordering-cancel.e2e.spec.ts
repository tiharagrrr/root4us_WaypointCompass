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
  lineRows,
  notices,
  type OrderBody,
  orderRow,
  outboxRows,
  resetOrders,
  seedOrder,
  setOrderVersion,
  tearDownWorld,
  type World,
  write,
} from './ordering.world';

const FRIDAY = '2026-10-02';
const AT_1000 = '2026-10-01T10:00:00+05:30';
const AT_1500 = '2026-10-01T15:00:00+05:30';
const AT_1600 = '2026-10-01T16:00:00+05:30';
const AT_1700 = '2026-10-01T17:00:00+05:30';

interface TemplateBody {
  id: string;
  name: string;
  tempClass: string;
  lines: { itemId: string; qty: number; sku: string }[];
}

interface RosterBody {
  outletId: string;
  date: string;
  entries: {
    staffName: string;
    fromMin: number;
    toMin: number;
    from: string;
  }[];
}

/**
 * Cancelling, the urgent flag, M8's reorder, presets and the receiving
 * roster: everything a store or dispatcher does to an order that is not a
 * line change (AC-ORD-07, 19 to 22, 27 and 28).
 */
describeWithDb('ordering cancel, reorder, presets and roster', () => {
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

  /** A SUBMITTED Fresh Kadawatha order for Friday, at version 3. */
  const submittedAtVersion3 = async () => {
    const seeded = await seedOrder(w, {
      outletId: w.outlets.kadawatha,
      status: 'SUBMITTED',
      requestedDate: FRIDAY,
      lines: [
        { itemId: w.items.dryA, qty: 2 },
        { itemId: w.items.dryB, qty: 1 },
      ],
    });
    await setOrderVersion(w, seeded.id, 3);
    return { ...seeded, version: 3 };
  };

  it('AC-ORD-19 store cancels before cutoff with note', async () => {
    const order = await submittedAtVersion3();

    const res = await write(w, 'store', 'post', `/orders/${order.id}/cancel`, 3)
      .set('Idempotency-Key', `cancel-${w.sfx}-19`)
      .send({ reasonNote: 'Ordered twice' });

    expect(res.status).toBe(200);
    const cancelled = data<OrderBody>(res);
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      cancelledAt: '2026-10-01T15:00:00+05:30',
      cancelReason: 'Ordered twice',
    });
    expect(cancelled._links.edit).toBeUndefined();
    expect(cancelled._links.cancel).toBeUndefined();
    expect(cancelled._links.submit).toBeUndefined();

    const audits = await auditRows(w, ORDER_AUDIT.cancelled, order.id);
    expect(audits).toHaveLength(1);
    expect(audits[0].reasonNote).toBe('Ordered twice');
    expect(await outboxRows(w, ORDER_EVENTS.cancelled, order.id)).toHaveLength(
      1,
    );

    // The slot is free again, so she can order for the same day.
    const again = await call(w, 'store', 'post', '/orders').send({
      tempClass: 'AMBIENT',
      requestedDate: FRIDAY,
      lines: [{ itemId: w.items.dryA, qty: 1 }],
    });
    expect(again.status).toBe(201);
  });

  it('AC-ORD-20 store cancel needs note, before cutoff', async () => {
    const order = await submittedAtVersion3();

    const noNote = await write(
      w,
      'store',
      'post',
      `/orders/${order.id}/cancel`,
      3,
    ).send({});

    expect(noNote.status).toBe(400);
    expect(expectProblem(noNote, 'VALIDATION_FAILED').errors).toEqual([
      expect.objectContaining({ field: 'reasonNote', code: 'required' }),
    ]);
    expect((await orderRow(w, order.id)).status).toBe('SUBMITTED');

    freezeClock(w.app, AT_1600);
    const late = await write(
      w,
      'store',
      'post',
      `/orders/${order.id}/cancel`,
      3,
    ).send({ reasonNote: 'Too late' });

    expect(late.status).toBe(409);
    expectProblem(late, 'CUTOFF_PASSED');
    expect(await orderRow(w, order.id)).toMatchObject({
      status: 'SUBMITTED',
      version: 3,
    });
    expect(await outboxRows(w, ORDER_EVENTS.cancelled, order.id)).toHaveLength(
      0,
    );
  });

  it('AC-ORD-21 dispatcher cancels before planning with code', async () => {
    const confirmed = await seedOrder(w, {
      outletId: w.outlets.kadawatha,
      status: 'CONFIRMED',
      requestedDate: FRIDAY,
    });
    freezeClock(w.app, AT_1700);

    const noCode = await write(
      w,
      'dispatcher',
      'post',
      `/orders/${confirmed.id}/cancel`,
      confirmed.version,
    ).send({});

    expect(noCode.status).toBe(400);
    expect(expectProblem(noCode, 'VALIDATION_FAILED').errors).toEqual([
      {
        field: 'reasonCode',
        code: 'required',
        message: 'A reason is required',
      },
    ]);

    const withCode = await write(
      w,
      'dispatcher',
      'post',
      `/orders/${confirmed.id}/cancel`,
      confirmed.version,
    ).send({ reasonCode: 'STORE_CLOSED' });

    expect(withCode.status).toBe(200);
    expect(data<OrderBody>(withCode).status).toBe('CANCELLED');
    const audits = await auditRows(w, ORDER_AUDIT.cancelled, confirmed.id);
    expect(audits).toHaveLength(1);
    expect(audits[0].reasonCode).toBe('STORE_CLOSED');
    expect(
      await outboxRows(w, ORDER_EVENTS.cancelled, confirmed.id),
    ).toHaveLength(1);

    const planned = await seedOrder(w, {
      outletId: w.outlets.otherFresh,
      status: 'PLANNED',
      requestedDate: FRIDAY,
    });
    const refused = await write(
      w,
      'dispatcher',
      'post',
      `/orders/${planned.id}/cancel`,
      planned.version,
    ).send({ reasonCode: 'STORE_CLOSED' });

    expect(refused.status).toBe(409);
    expectProblem(refused, 'CONFLICT_STATE');
    expect((await orderRow(w, planned.id)).status).toBe('PLANNED');
  });

  it('AC-ORD-22 dispatcher marks an order urgent', async () => {
    const seeded = await seedOrder(w, {
      outletId: w.outlets.kadawatha,
      status: 'CONFIRMED',
      requestedDate: FRIDAY,
    });
    await setOrderVersion(w, seeded.id, 2);

    const res = await write(
      w,
      'dispatcher',
      'patch',
      `/orders/${seeded.id}/priority`,
      2,
    ).send({ urgent: true });

    expect(res.status).toBe(200);
    expect(data<OrderBody>(res)).toMatchObject({ urgent: true, version: 3 });
    const audits = await auditRows(w, ORDER_AUDIT.priorityChanged, seeded.id);
    expect(audits).toHaveLength(1);
    expect(audits[0].before).toMatchObject({ urgent: false });
    expect(audits[0].after).toMatchObject({ urgent: true });
    expect(
      await outboxRows(w, ORDER_EVENTS.priorityChanged, seeded.id),
    ).toHaveLength(1);
  });

  it('AC-ORD-07 reorder from order history', async () => {
    const received = await seedOrder(w, {
      outletId: w.outlets.kadawatha,
      status: 'RECEIVED',
      requestedDate: '2026-09-29',
      lines: [
        { itemId: w.items.dryA, qty: 2 },
        { itemId: w.items.dryB, qty: 3 },
        { itemId: w.items.retired, qty: 1 },
      ],
    });
    freezeClock(w.app, AT_1000);

    const res = await call(
      w,
      'store',
      'post',
      `/orders/${received.id}/reorder`,
    ).send({});

    expect(res.status).toBe(201);
    const draft = data<OrderBody>(res);
    expect(res.headers.location).toBe(`/api/v1/orders/${draft.id}`);
    expect(draft).toMatchObject({
      status: 'DRAFT',
      tempClass: 'AMBIENT',
      requestedDate: FRIDAY,
      deliveryDate: FRIDAY,
    });
    expect((await orderRow(w, draft.id)).source).toBe('reorder');

    // The two items still in the catalog, at their original quantities:
    // two packs of rice at 10 kg and three of flour at 20 kg.
    const lines = await lineRows(w, draft.id);
    expect(lines).toHaveLength(2);
    expect(
      lines
        .map((l) => [l.itemId, l.qty])
        .sort((a, b) => (a[0] > b[0] ? 1 : -1)),
    ).toEqual(
      [
        [w.items.dryA, 2],
        [w.items.dryB, 3],
      ].sort((a, b) => (a[0] > b[0] ? 1 : -1)),
    );
    expect(draft.totals).toMatchObject({ lines: 2, units: 5, weightKg: 80 });

    const notice = notices(res).find(
      (n) => n.code === ORDER_NOTICES.itemsLeftOut,
    );
    expect(notice?.message).toContain(`Discontinued tea ${w.sfx}`);

    const original = await orderRow(w, received.id);
    expect(original).toMatchObject({
      status: 'RECEIVED',
      version: received.version,
      requestedDate: '2026-09-29',
    });
    expect(await lineRows(w, received.id)).toHaveLength(3);
  });

  it('AC-ORD-27 save and reuse a template', async () => {
    const order = await seedOrder(w, {
      outletId: w.outlets.kadawatha,
      status: 'SUBMITTED',
      requestedDate: FRIDAY,
      lines: [
        { itemId: w.items.dryA, qty: 2 },
        { itemId: w.items.dryB, qty: 1 },
        { itemId: w.items.dryC, qty: 4 },
      ],
    });

    const saved = await call(
      w,
      'store',
      'post',
      `/orders/${order.id}/save-as-template`,
    ).send({ name: 'Weekday dry' });

    expect(saved.status).toBe(201);
    const template = data<TemplateBody>(saved);
    expect(template).toMatchObject({
      name: 'Weekday dry',
      tempClass: 'AMBIENT',
    });
    expect(template.lines.map((l) => [l.itemId, l.qty]).sort()).toEqual(
      [
        [w.items.dryA, 2],
        [w.items.dryB, 1],
        [w.items.dryC, 4],
      ].sort(),
    );

    const twice = await call(
      w,
      'store',
      'post',
      `/orders/${order.id}/save-as-template`,
    ).send({ name: 'Weekday dry' });

    expect(twice.status).toBe(409);
    expectProblem(twice, 'CONFLICT_STATE');
    const list = await call(w, 'store', 'get', '/order-templates');
    expect(
      (list.body as { data: TemplateBody[] }).data.filter(
        (t) => t.name === 'Weekday dry',
      ),
    ).toHaveLength(1);

    const fromTemplate = await call(w, 'store', 'post', '/orders').send({
      tempClass: 'AMBIENT',
      requestedDate: '2026-10-03',
      templateId: template.id,
    });

    expect(fromTemplate.status).toBe(201);
    const newDraft = data<OrderBody>(fromTemplate);
    expect(newDraft.templateId).toBe(template.id);
    expect(newDraft.totals.lines).toBe(3);
    expect(await lineRows(w, newDraft.id)).toHaveLength(3);
  });

  it('AC-ORD-28 receiving roster replaces the day', async () => {
    const put = (role: 'store' | 'otherStore', outletId: string) =>
      call(
        w,
        role,
        'put',
        `/outlets/${outletId}/receiving-roster?date=${FRIDAY}`,
      );

    await put('store', w.outlets.kadawatha).send({
      entries: [{ staffName: 'Nimali', fromMin: 420, toMin: 480 }],
    });

    const replaced = await put('store', w.outlets.kadawatha).send({
      entries: [
        { staffName: 'Nadeesha', fromMin: 420, toMin: 540 },
        { staffName: 'Ruwan', fromMin: 540, toMin: 600 },
      ],
    });
    expect(replaced.status).toBe(200);

    const read = data<RosterBody>(
      await call(
        w,
        'store',
        'get',
        `/outlets/${w.outlets.kadawatha}/receiving-roster?date=${FRIDAY}`,
      ),
    );
    expect(read.entries).toHaveLength(2);
    expect(read.entries.map((e) => e.staffName)).toEqual(['Nadeesha', 'Ruwan']);
    expect(read.entries[0]).toMatchObject({ fromMin: 420, from: '07:00' });
    expect(
      await auditRows(
        w,
        ORDER_AUDIT.rosterReplaced,
        `${w.outlets.kadawatha}#${FRIDAY}`,
      ),
    ).toHaveLength(2);

    const elsewhere = await put('store', w.outlets.otherFresh).send({
      entries: [{ staffName: 'Someone else', fromMin: 420, toMin: 480 }],
    });

    expect(elsewhere.status).toBe(404);
    expectProblem(elsewhere, 'NOT_FOUND');
    const other = data<RosterBody>(
      await call(
        w,
        'otherStore',
        'get',
        `/outlets/${w.outlets.otherFresh}/receiving-roster?date=${FRIDAY}`,
      ),
    );
    expect(other.entries).toHaveLength(0);
  });
});
