import { JobContextRunner } from '../../../core/context/job-context';
import type { DeliveredEvent } from '../../../core/outbox/event-bus';
import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem } from '../../../../test/kernel';
import type { ReceiptDto } from '../dto/receipt.dto';
import { ReceiptEventListener } from '../services/receipt-event.listener';
import {
  at,
  auditRows,
  buildWorld,
  call,
  data,
  issueRows,
  orderRow,
  outboxRows,
  receiptLineRows,
  receiptRows,
  resetDeliveries,
  type SeededDelivery,
  seedDelivery,
  syncDelivery,
  tearDownWorld,
  type World,
} from './receipt.world';

/**
 * Confirming a receipt, M5 (specs/receipt/spec.md, AC-RCP-01 to 09 and 15). Each test is one
 * criterion, named after it. The criteria's people and times are the world's: Nimesha at
 * Fresh Kadawatha, Tihara the dispatcher, Aniqa the driver, 2026-10-02 in Asia/Colombo.
 *
 * Not asserted here, because other modules own them: the STORE_ISSUE alert alerts raises
 * from `issue.reported` (the payload below is the one alerts parses), and the push, in-app
 * and email notices notifications sends.
 */
describeWithDb('receipt: confirm', () => {
  jest.setTimeout(60_000);

  let world: World;

  beforeAll(async () => {
    world = await buildWorld();
  });

  afterAll(async () => {
    await tearDownWorld(world);
  });

  beforeEach(async () => {
    await resetDeliveries(world);
  });

  const all = (seeded: SeededDelivery) =>
    seeded.lineIds.map((orderLineId) => ({
      orderLineId,
      qtyReceived: 12,
      condition: 'ok',
    }));

  const view = (res: { body: unknown }) =>
    (res.body as { data: ReceiptDto }).data;

  it('AC-RCP-01 confirm a clean delivery', async () => {
    const seeded = await seedDelivery(world);
    at(world, '2026-10-02T09:10:00+05:30');

    const res = await call(
      world,
      'store',
      'post',
      `/orders/${seeded.orderId}/receipt`,
      {
        ifMatch: 8,
        key: 'k-clean',
        body: { lines: all(seeded) },
      },
    );

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(
      `/api/v1/orders/${seeded.orderId}/receipt`,
    );
    const receipt = view(res);
    expect(receipt).toMatchObject({
      status: 'CONFIRMED',
      awaitingDriverSync: false,
      confirmedById: world.as.store.id,
      confirmedAt: '2026-10-02T09:10:00+05:30',
      orderStatus: 'RECEIVED',
    });
    const order = await orderRow(world, seeded.orderId);
    expect(order).toMatchObject({ status: 'RECEIVED', version: 9 });
    expect(await auditRows(world, 'receipt.confirmed')).toHaveLength(1);
    expect(await outboxRows(world, 'receipt.confirmed')).toHaveLength(1);
    expect(await issueRows(world, seeded.orderId)).toHaveLength(0);
    // No confirm link now, and M3 no longer lists the order as a receipt to confirm.
    expect(receipt._links.confirm).toBeUndefined();
    const toConfirm = await call(
      world,
      'store',
      'get',
      '/orders?filter[status]=DELIVERED,PARTIAL&limit=100',
    );
    const ids = data<{ id: string }[]>(toConfirm).map((o) => o.id);
    expect(ids).not.toContain(seeded.orderId);
  });

  it('AC-RCP-02 a short line opens an issue', async () => {
    const seeded = await seedDelivery(world);
    at(world, '2026-10-02T09:10:00+05:30');
    const lines = all(seeded);
    lines[1] = { ...lines[1], qtyReceived: 10, condition: 'short' };

    const res = await call(
      world,
      'store',
      'post',
      `/orders/${seeded.orderId}/receipt`,
      {
        ifMatch: 8,
        key: 'k-short',
        body: { lines, note: '2 trays short' },
      },
    );

    expect(res.status).toBe(201);
    const receipt = view(res);
    expect(receipt.status).toBe('CONFIRMED_WITH_ISSUES');
    const [stored] = await receiptRows(world, seeded.orderId);
    const line2 = (await receiptLineRows(world, stored.id)).find(
      (l) => l.orderLineId === seeded.lineIds[1],
    );
    expect(line2).toMatchObject({ qtyReceived: 10, condition: 'short' });

    const [issue, ...rest] = await issueRows(world, seeded.orderId);
    expect(rest).toHaveLength(0);
    expect(issue).toMatchObject({
      outletId: world.kadawatha,
      type: 'SHORT',
      qtyAffected: 2,
      status: 'OPEN',
      raisedByRole: 'store_manager',
      receiptId: stored.id,
      orderLineId: seeded.lineIds[1],
    });
    expect((await orderRow(world, seeded.orderId)).status).toBe(
      'ISSUE_REPORTED',
    );
    expect(await auditRows(world, 'receipt.confirmed')).toHaveLength(1);
    expect(await auditRows(world, 'receipt.issue.reported')).toHaveLength(1);
    expect(await outboxRows(world, 'receipt.confirmed')).toHaveLength(1);
    const reported = await outboxRows(world, 'issue.reported');
    expect(reported).toHaveLength(1);
    // The fields alerts parses to raise the STORE_ISSUE alert for the dispatcher's 01 panel.
    expect(reported[0].payload).toMatchObject({
      v: 1,
      issueId: issue.id,
      type: 'SHORT',
      outletId: world.kadawatha,
      orderId: seeded.orderId,
      raisedById: world.as.store.id,
    });
    expect(reported[0].depotId).toBe(world.depot.plg);
  });

  it('AC-RCP-03 confirm before the driver’s record syncs', async () => {
    const seeded = await seedDelivery(world, {
      orderStatus: 'IN_TRANSIT',
      stopStatus: 'PENDING',
      etaAt: '2026-10-02T04:10:00+05:30',
      lines: [
        { expected: 12, delivered: null },
        { expected: 12, delivered: null },
        { expected: 12, delivered: null },
      ],
    });
    at(world, '2026-10-02T04:40:00+05:30');

    const res = await call(
      world,
      'store',
      'post',
      `/orders/${seeded.orderId}/receipt`,
      {
        ifMatch: 8,
        key: 'k-early',
        body: { lines: all(seeded) },
      },
    );

    expect(res.status).toBe(201);
    expect(view(res)).toMatchObject({
      status: 'CONFIRMED',
      awaitingDriverSync: true,
      orderStatus: 'IN_TRANSIT',
    });
    expect((await orderRow(world, seeded.orderId)).status).toBe('IN_TRANSIT');
    const waiting = await call(
      world,
      'store',
      'get',
      `/orders/${seeded.orderId}/receipt`,
    );
    expect(view(waiting)).toMatchObject({ awaitingDriverSync: true });
    expect(view(waiting).lines.every((l) => l.qtyDelivered === null)).toBe(
      true,
    );

    // Aniqa's phone syncs the DELIVERED event at 05:05 and stop.completed is delivered.
    at(world, '2026-10-02T05:05:00+05:30');
    await syncDelivery(
      world,
      seeded,
      '2026-10-02T04:22:00+05:30',
      [12, 12, 12],
    );
    const listener = world.app.get(ReceiptEventListener);
    const event: DeliveredEvent = {
      id: 'evt-stop-completed-1',
      type: 'stop.completed',
      depotId: world.depot.plg,
      outletIds: [world.kadawatha],
      userIds: [],
      payload: {
        v: 1,
        tripId: seeded.tripId,
        stopId: seeded.stopId,
        orderId: seeded.orderId,
        outletId: world.kadawatha,
        outcome: 'DELIVERED',
        unitsDelivered: 36,
      },
      occurredAt: new Date('2026-10-02T05:05:00+05:30'),
      correlationId: null,
    };
    // The relay hands the event over inside a job context, stamped as the system.
    const relay = (e: DeliveredEvent) =>
      world.app
        .get(JobContextRunner)
        .run({ id: `test:relay:${e.id}` }, () => listener.handle(e));
    expect(await relay(event)).toBe(true);

    const [receipt] = await receiptRows(world, seeded.orderId);
    expect(receipt.awaitingDriverSync).toBe(false);
    expect((await orderRow(world, seeded.orderId)).status).toBe('RECEIVED');
    // The relay delivers at least once: a replay finds nothing waiting and changes nothing.
    expect(await relay(event)).toBe(false);
    expect(
      await auditRows(world, 'receipt.reconciled', receipt.id),
    ).toHaveLength(1);
    expect(await receiptRows(world, seeded.orderId)).toHaveLength(1);
  });

  it('AC-RCP-04 a partial delivery confirmed as delivered', async () => {
    const seeded = await seedDelivery(world, {
      orderStatus: 'PARTIAL',
      stopStatus: 'PARTIAL',
      lines: [
        { expected: 12, delivered: 12 },
        { expected: 12, delivered: 10 },
        { expected: 12, delivered: 12 },
      ],
    });
    at(world, '2026-10-02T09:10:00+05:30');
    const lines = all(seeded);
    lines[1] = { ...lines[1], qtyReceived: 10 };

    const res = await call(
      world,
      'store',
      'post',
      `/orders/${seeded.orderId}/receipt`,
      {
        ifMatch: 8,
        key: 'k-partial',
        body: { lines },
      },
    );

    expect(res.status).toBe(201);
    expect(view(res).status).toBe('CONFIRMED');
    expect((await orderRow(world, seeded.orderId)).status).toBe('RECEIVED');
    expect(await issueRows(world, seeded.orderId)).toHaveLength(0);
  });

  it('AC-RCP-05 no confirmation before delivery or ETA', async () => {
    const seeded = await seedDelivery(world, {
      orderStatus: 'IN_TRANSIT',
      stopStatus: 'PENDING',
      etaAt: '2026-10-02T04:10:00+05:30',
      lines: [
        { expected: 12, delivered: null },
        { expected: 12, delivered: null },
        { expected: 12, delivered: null },
      ],
    });
    at(world, '2026-10-02T03:55:00+05:30');

    const res = await call(
      world,
      'store',
      'get',
      `/orders/${seeded.orderId}/receipt`,
    );

    expect(res.status).toBe(200);
    const receipt = view(res);
    expect(receipt.lines).toHaveLength(3);
    expect(receipt.lines.every((l) => l.qtyDelivered === null)).toBe(true);
    expect(receipt.awaitingDriverSync).toBe(false);
    expect(receipt._links.confirm).toBeUndefined();

    const post = await call(
      world,
      'store',
      'post',
      `/orders/${seeded.orderId}/receipt`,
      {
        ifMatch: 8,
        key: 'k-too-early',
        body: { lines: all(seeded) },
      },
    );
    expect(post.status).toBe(409);
    expectProblem(post, 'CONFLICT_STATE');
    expect(await receiptRows(world, seeded.orderId)).toHaveLength(0);
  });

  it('AC-RCP-06 no auto-confirm', async () => {
    const seeded = await seedDelivery(world);

    at(world, '2026-10-03T09:00:00+05:30');

    expect(await receiptRows(world, seeded.orderId)).toHaveLength(0);
    expect((await orderRow(world, seeded.orderId)).status).toBe('DELIVERED');
    const toConfirm = await call(
      world,
      'store',
      'get',
      '/orders?filter[status]=DELIVERED,PARTIAL&limit=100',
    );
    expect(data<{ id: string }[]>(toConfirm).map((o) => o.id)).toContain(
      seeded.orderId,
    );
    const res = await call(
      world,
      'store',
      'get',
      `/orders/${seeded.orderId}/receipt`,
    );
    expect(view(res)._links.confirm).toBeDefined();
  });

  it('AC-RCP-07 confirmation needs the current order version', async () => {
    const seeded = await seedDelivery(world);
    at(world, '2026-10-02T09:10:00+05:30');
    const path = `/orders/${seeded.orderId}/receipt`;

    const missing = await call(world, 'store', 'post', path, {
      key: 'k-no-match',
      body: { lines: all(seeded) },
    });
    expect(missing.status).toBe(428);
    expectProblem(missing, 'PRECONDITION_REQUIRED');

    const stale = await call(world, 'store', 'post', path, {
      ifMatch: 7,
      key: 'k-stale',
      body: { lines: all(seeded) },
    });
    expect(stale.status).toBe(412);
    expectProblem(stale, 'VERSION_MISMATCH');

    expect(await receiptRows(world, seeded.orderId)).toHaveLength(0);
    expect(await issueRows(world, seeded.orderId)).toHaveLength(0);
    expect(await auditRows(world, 'receipt.confirmed')).toHaveLength(0);
    expect(await outboxRows(world, 'receipt.confirmed')).toHaveLength(0);
    expect(await orderRow(world, seeded.orderId)).toMatchObject({
      status: 'DELIVERED',
      version: 8,
    });
  });

  it('AC-RCP-08 a retried confirmation applies once', async () => {
    const seeded = await seedDelivery(world);
    at(world, '2026-10-02T09:10:00+05:30');
    const path = `/orders/${seeded.orderId}/receipt`;
    const body = { lines: all(seeded) };

    const first = await call(world, 'store', 'post', path, {
      ifMatch: 8,
      key: 'K',
      body,
    });
    expect(first.status).toBe(201);

    const replay = await call(world, 'store', 'post', path, {
      ifMatch: 8,
      key: 'K',
      body,
    });
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    // The replay is the stored answer; only the envelope's request id is new.
    expect(data(replay)).toEqual(data(first));
    expect(await receiptRows(world, seeded.orderId)).toHaveLength(1);
    expect(await auditRows(world, 'receipt.confirmed')).toHaveLength(1);
    expect(await outboxRows(world, 'receipt.confirmed')).toHaveLength(1);

    const reused = await call(world, 'store', 'post', path, {
      ifMatch: 8,
      key: 'K',
      body: { lines: all(seeded), note: 'a different request' },
    });
    expect(reused.status).toBe(422);
    expectProblem(reused, 'IDEMPOTENCY_KEY_REUSED');

    const again = await call(world, 'store', 'post', path, {
      ifMatch: 9,
      key: 'K2',
      body,
    });
    expect(again.status).toBe(409);
    expectProblem(again, 'CONFLICT_STATE');
    expect(await receiptRows(world, seeded.orderId)).toHaveLength(1);
  });

  it('AC-RCP-09 who may read and confirm', async () => {
    const seeded = await seedDelivery(world);
    at(world, '2026-10-02T09:10:00+05:30');
    const path = `/orders/${seeded.orderId}/receipt`;
    const attempt = { ifMatch: 8, key: 'k-who', body: { lines: all(seeded) } };

    const dispatcherPost = await call(
      world,
      'dispatcher',
      'post',
      path,
      attempt,
    );
    expect(dispatcherPost.status).toBe(403);
    expectProblem(dispatcherPost, 'FORBIDDEN');

    const dispatcherGet = await call(world, 'dispatcher', 'get', path);
    expect(dispatcherGet.status).toBe(200);
    expect(view(dispatcherGet)._links.confirm).toBeUndefined();

    for (const role of ['driver', 'loader'] as const) {
      const res = await call(world, role, 'get', path);
      expect(res.status).toBe(403);
      expectProblem(res, 'FORBIDDEN');
    }

    const otherGet = await call(world, 'otherStore', 'get', path);
    expect(otherGet.status).toBe(404);
    expectProblem(otherGet, 'NOT_FOUND');
    const otherPost = await call(world, 'otherStore', 'post', path, attempt);
    expect(otherPost.status).toBe(404);
    expect(await receiptRows(world, seeded.orderId)).toHaveLength(0);
  });

  it('AC-RCP-15 proof of delivery on M5', async () => {
    const seeded = await seedDelivery(world, {
      receiverName: 'S. Perera',
      proofFiles: true,
    });
    at(world, '2026-10-02T09:10:00+05:30');

    const res = await call(
      world,
      'store',
      'get',
      `/orders/${seeded.orderId}/receipt`,
    );

    expect(res.status).toBe(200);
    const receipt = view(res);
    expect(receipt.lines).toHaveLength(3);
    // Each line says what the item is (a blank name once reached M5 through getWithLines).
    for (const line of receipt.lines) {
      expect(line.name).not.toBe('');
      expect(line.sku).not.toBe('');
      expect(line.packLabel).toBe('Bag ×4');
      break;
    }
    for (const line of receipt.lines) {
      expect(line).toMatchObject({ qtyExpected: 12, qtyDelivered: 12 });
    }
    expect(receipt.proof).toMatchObject({
      receiverName: 'S. Perera',
      deliveredAt: '2026-10-02T04:22:00+05:30',
    });
    expect(receipt.proof.signature?.href).toMatch(/^\/api\/v1\/attachments\//);
    expect(receipt.proof.photo?.href).toMatch(/^\/api\/v1\/attachments\//);
    expect(receipt.awaitingDriverSync).toBe(false);
    expect(receipt._links.confirm).toBeDefined();
    expect(res.headers.etag).toBe('W/"8"');
  });
});
