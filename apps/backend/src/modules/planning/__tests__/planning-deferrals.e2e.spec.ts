import { and, eq } from 'drizzle-orm';
import { describeWithDb } from '../../../../test/create-test-app';
import { depotFixture, outletFixture, suffix } from '../../../../test/fixtures';
import { expectProblem } from '../../../../test/kernel';
import { JobContextRunner } from '../../../core/context/job-context';
import { EventBus } from '../../../core/outbox/event-bus';
import { alerts, deferrals, orders, plans, users } from '../../../db/schema';
import type { DeferralDto } from '../dto/deferral.dto';
import {
  auditCount,
  buildWorld,
  call,
  data,
  OPEN,
  outboxOf,
  tearDown,
  type World,
} from './planning.world';

interface Given {
  planStatus?: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  status?: 'PROPOSED' | 'CONFIRMED';
  orderStatus?: 'CONFIRMED' | 'DEFERRED' | 'PLANNED';
}

let day = 0;

/**
 * A deferral for an order at Nimesha's outlet, on a plan of its own (one
 * plan per depot and date, so each call takes the next date). By default the
 * plan is published and the order is waiting as DEFERRED, which is what M4
 * and M7 show.
 */
async function deferralFor(w: World, given: Given = {}): Promise<string> {
  day += 1;
  const date = `2026-11-${String(day).padStart(2, '0')}`;
  const next = `2026-11-${String(day + 1).padStart(2, '0')}`;
  const [plan] = await w.db
    .insert(plans)
    .values({
      depotId: w.store.depotId,
      date,
      status: given.planStatus ?? 'PUBLISHED',
      revision: given.planStatus === 'DRAFT' ? 0 : 1,
    })
    .returning();
  const [order] = await w.db
    .insert(orders)
    .values({
      orderNo: `D${Date.now().toString(36)}${day}`,
      outletId: w.store.outletId,
      depotId: w.store.depotId,
      brand: 'FRESH',
      districtId: w.store.districtId,
      tempClass: 'CHILLED',
      requestedDate: date,
      deliveryDate: next,
      status: given.orderStatus ?? 'DEFERRED',
      deferredCount: 1,
      units: 10,
      weightKg: 100,
      volumeM3: 1,
      source: 'backorder',
    })
    .returning();
  const [row] = await w.db
    .insert(deferrals)
    .values({
      orderId: order.id,
      planId: plan.id,
      status: given.status ?? 'CONFIRMED',
      source: 'ENGINE',
      reasonCode: 'OVER_CAPACITY',
      choice: 'UNAVOIDABLE',
      bindingRule: 'CAP_VOLUME',
      reasonDetail: { tried: [{ vehicle: 'REF-07', volumeM3: 12.4 }] },
      priorityScore: 58,
      note: 'First on tomorrow’s run',
      fromDate: date,
      toDate: next,
      decidedAt: new Date(OPEN),
    })
    .returning();
  return row.id;
}

const respond = (w: World, id: string, body: Record<string, unknown>) =>
  call(w, 'store_manager', 'post', `/deferrals/${id}/response`, {
    key: crypto.randomUUID(),
    body,
  });

/**
 * The relay's delivery of one outbox row to every consumer of its type, as
 * ROO-24 does it (alerts raises PRIORITY_REQUEST from it).
 */
async function relay(w: World, type: string, deferralId: string) {
  const [row] = await outboxOf(w, type, deferralId);
  for (const consumer of w.app.get(EventBus).consumersOf(type))
    await w.app
      .get(JobContextRunner)
      .run({ id: `test:relay:${row.id}` }, () => consumer.handle(row));
}

const priorityAlerts = (w: World, orderId: string) =>
  w.db
    .select()
    .from(alerts)
    .where(
      and(eq(alerts.type, 'PRIORITY_REQUEST'), eq(alerts.orderId, orderId)),
    );

describeWithDb('planning: deferral reads and responses', () => {
  jest.setTimeout(120_000);
  let w: World;

  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(() => tearDown(w));

  it('AC-PLN-16 the store reads the reason in its own words', async () => {
    const id = await deferralFor(w);

    const store = data<DeferralDto>(
      await call(w, 'store_manager', 'get', `/deferrals/${id}`),
    );
    expect(store).toMatchObject({
      id,
      status: 'CONFIRMED',
      orderStatus: 'DEFERRED',
      outletId: w.store.outletId,
      reasonCode: 'OVER_CAPACITY',
      reasonText: 'Every suitable vehicle was full for this run.',
      note: 'First on tomorrow’s run',
      storeResponse: 'AWAITING',
      // Never the engine's numbers (AC-PLN-16).
      choice: null,
      bindingRule: null,
      priorityScore: null,
    });
    expect(store.orderNo).toMatch(/^D/);
    expect(store._links.respond).toMatchObject({ method: 'POST' });
    expect(store._links.reverse).toBeUndefined();

    const dispatcher = data<DeferralDto>(
      await call(w, 'dispatcher', 'get', `/deferrals/${id}`),
    );
    expect(dispatcher).toMatchObject({
      choice: 'UNAVOIDABLE',
      bindingRule: 'CAP_VOLUME',
      priorityScore: 58,
      reasonLabel: 'Fleet full',
    });
    expect(dispatcher._links.respond).toBeUndefined();
    expect(dispatcher._links.reverse).toMatchObject({ method: 'POST' });
  });

  it('AC-PLN-32 a store sees only its own deferrals once their plan is published', async () => {
    const shown = await deferralFor(w);
    const proposed = await deferralFor(w, { status: 'PROPOSED' });
    const onDraft = await deferralFor(w, { planStatus: 'DRAFT' });

    for (const hidden of [proposed, onDraft]) {
      const res = await call(w, 'store_manager', 'get', `/deferrals/${hidden}`);
      expectProblem(res, 'NOT_FOUND');
    }
    // Another depot's dispatcher does not see Peliyagoda's deferrals at all.
    expectProblem(
      await call(w, 'kandy', 'get', `/deferrals/${shown}`),
      'NOT_FOUND',
    );

    const listed = data<DeferralDto[]>(
      await call(w, 'store_manager', 'get', '/deferrals?limit=100'),
    ).map((d) => d.id);
    expect(listed).toContain(shown);
    expect(listed).not.toContain(proposed);
    expect(listed).not.toContain(onDraft);

    const all = data<DeferralDto[]>(
      await call(w, 'dispatcher', 'get', '/deferrals?limit=100'),
    ).map((d) => d.id);
    expect(all).toEqual(expect.arrayContaining([shown, proposed, onDraft]));
  });

  it('AC-PLN-27 the store requests priority', async () => {
    const id = await deferralFor(w);
    const [{ orderId }] = await w.db
      .select({ orderId: deferrals.orderId })
      .from(deferrals)
      .where(eq(deferrals.id, id));

    expectProblem(
      await respond(w, id, { response: 'PRIORITY_REQUESTED' }),
      'VALIDATION_FAILED',
    );

    const res = await respond(w, id, {
      response: 'PRIORITY_REQUESTED',
      note: 'We run out of milk by noon',
    });
    expect(res.status).toBe(200);
    const body = data<DeferralDto>(res);
    expect(body).toMatchObject({
      storeResponse: 'PRIORITY_REQUESTED',
      storeNote: 'We run out of milk by noon',
      storeRespondedAt: new Date(OPEN).toISOString(),
    });
    expect(body._links.respond).toBeUndefined();

    const [row] = await w.db
      .select()
      .from(deferrals)
      .where(eq(deferrals.id, id));
    expect(row.storeRespondedById).toBeTruthy();
    // The order is untouched: it still waits for its next run.
    const [order] = await w.db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(order.status).toBe('DEFERRED');

    expect(await auditCount(w, 'planning.deferral.store_responded', id)).toBe(
      1,
    );
    const events = await outboxOf(w, 'deferral.store_responded', id);
    expect(events).toHaveLength(1);
    expect(events[0].depotId).toBe(w.store.depotId);
    await relay(w, 'deferral.store_responded', id);
    expect(await priorityAlerts(w, orderId)).toEqual([
      expect.objectContaining({ status: 'OPEN', depotId: w.store.depotId }),
    ]);

    // Answered once; there is nothing left to respond to.
    expectProblem(
      await respond(w, id, { response: 'ACKNOWLEDGED' }),
      'CONFLICT_STATE',
    );

    // Acknowledging instead opens no alert.
    const quiet = await deferralFor(w);
    const ack = await respond(w, quiet, { response: 'ACKNOWLEDGED' });
    expect(data<DeferralDto>(ack).storeResponse).toBe('ACKNOWLEDGED');
    const [quietRow] = await w.db
      .select()
      .from(deferrals)
      .where(eq(deferrals.id, quiet));
    await relay(w, 'deferral.store_responded', quiet);
    expect(await priorityAlerts(w, quietRow.orderId)).toHaveLength(0);
  });

  it('a store cannot respond once the order is planned again', async () => {
    const id = await deferralFor(w, { orderStatus: 'PLANNED' });
    const read = data<DeferralDto>(
      await call(w, 'store_manager', 'get', `/deferrals/${id}`),
    );
    expect(read._links.respond).toBeUndefined();
    expectProblem(
      await respond(w, id, { response: 'ACKNOWLEDGED' }),
      'CONFLICT_STATE',
    );
  });

  it('AC-PLN-28 reversing a deferral keeps the delivery', async () => {
    const id = await deferralFor(w);
    const res = await call(
      w,
      'dispatcher',
      'post',
      `/deferrals/${id}/reverse`,
      {
        key: crypto.randomUUID(),
        body: { reason: 'Delivered while offline' },
      },
    );
    expect(res.status).toBe(200);
    const body = data<DeferralDto>(res);
    expect(body.status).toBe('REVERSED');
    expect(body._links.reverse).toBeUndefined();

    const [row] = await w.db
      .select()
      .from(deferrals)
      .where(eq(deferrals.id, id));
    expect(row.reversedAt?.toISOString()).toBe(new Date(OPEN).toISOString());
    expect(row.reversedReason).toBe('Delivered while offline');
    expect(await outboxOf(w, 'deferral.reversed', id)).toHaveLength(1);
    expect(await auditCount(w, 'planning.deferral.reversed', id)).toBe(1);

    const proposed = await deferralFor(w, { status: 'PROPOSED' });
    expectProblem(
      await call(w, 'dispatcher', 'post', `/deferrals/${proposed}/reverse`, {
        key: crypto.randomUUID(),
        body: { reason: 'x' },
      }),
      'CONFLICT_STATE',
    );
  });

  it('AC-PLN-35 the dispatcher replies to the store', async () => {
    const id = await deferralFor(w);
    await respond(w, id, {
      response: 'PRIORITY_REQUESTED',
      note: 'Dairy shelf is empty',
    });
    const reply = (role: 'dispatcher' | 'store_manager', text: string) =>
      call(w, role, 'post', `/deferrals/${id}/reply`, {
        key: crypto.randomUUID(),
        body: { text },
      });

    const before = data<DeferralDto>(
      await call(w, 'dispatcher', 'get', `/deferrals/${id}`),
    );
    expect(before._links.reply).toMatchObject({ method: 'POST' });
    expectProblem(await reply('dispatcher', '  '), 'VALIDATION_FAILED');

    const res = await reply('dispatcher', 'Pinned to Friday’s first run');
    expect(res.status).toBe(200);
    const body = data<DeferralDto>(res);
    expect(body).toMatchObject({
      dispatcherReply: 'Pinned to Friday’s first run',
      dispatcherRepliedAt: new Date(OPEN).toISOString(),
    });
    expect(body._links.reply).toBeUndefined();
    const [row] = await w.db
      .select()
      .from(deferrals)
      .where(eq(deferrals.id, id));
    expect(row.dispatcherRepliedById).toBeTruthy();

    // Nimesha reads it on M4, and never gets a reply link herself.
    const store = data<DeferralDto>(
      await call(w, 'store_manager', 'get', `/deferrals/${id}`),
    );
    expect(store.dispatcherReply).toBe('Pinned to Friday’s first run');
    expect(store.storeRespondedByName).toEqual(expect.any(String));
    expect(store._links.reply).toBeUndefined();

    expect(await auditCount(w, 'planning.deferral.replied', id)).toBe(1);
    expect(await outboxOf(w, 'deferral.replied', id)).toHaveLength(1);
    expectProblem(await reply('dispatcher', 'Again'), 'CONFLICT_STATE');

    const proposed = await deferralFor(w, {
      status: 'PROPOSED',
      planStatus: 'DRAFT',
    });
    const draft = data<DeferralDto>(
      await call(w, 'dispatcher', 'get', `/deferrals/${proposed}`),
    );
    expect(draft._links.reply).toBeUndefined();
  });

  it("AC-PLN-36 the deferral log answers the dispatcher's questions", async () => {
    const sfx = suffix();
    const depot = await depotFixture(w.db, sfx);
    const place = { depotId: depot.plg, districtId: depot.plgDistrict };
    const kadawatha = await outletFixture(w.db, `KW${sfx}`, place, {
      name: `Fresh Kadawatha ${sfx}`,
    });
    const gampaha = await outletFixture(w.db, `GP${sfx}`, place, {
      name: `Fresh Gampaha ${sfx}`,
    });
    const tihara = `u-${sfx}`;
    await w.db.insert(users).values({
      id: tihara,
      name: 'Tihara Egodage',
      email: `tihara-${sfx}@test.local`,
      role: 'dispatcher',
    });

    // Five runs; Gampaha deferred on the third, Kadawatha on the fourth and fifth.
    const runs = await w.db
      .insert(plans)
      .values(
        [1, 2, 3, 4, 5].map((n) => ({
          depotId: depot.plg,
          date: `2026-12-0${n}`,
          status: 'PUBLISHED' as const,
          revision: 1,
        })),
      )
      .returning();
    const defer = async (outletId: string, run: number, reasonCode: string) => {
      const plan = runs[run - 1];
      const [order] = await w.db
        .insert(orders)
        .values({
          orderNo: `L${sfx}${outletId.slice(0, 2)}${run}`,
          outletId,
          depotId: depot.plg,
          brand: 'FRESH',
          districtId: depot.plgDistrict,
          tempClass: 'CHILLED',
          requestedDate: plan.date,
          deliveryDate: `2026-12-0${run + 1}`,
          status: 'DEFERRED',
          deferredCount: 1,
          units: 10,
          weightKg: 100,
          volumeM3: 1,
        })
        .returning();
      const [row] = await w.db
        .insert(deferrals)
        .values({
          orderId: order.id,
          planId: plan.id,
          status: 'CONFIRMED',
          source: 'PLANNING',
          reasonCode,
          fromDate: plan.date,
          toDate: `2026-12-0${run + 1}`,
          decidedById: tihara,
          decidedAt: new Date(OPEN),
        })
        .returning();
      return row.id;
    };
    await defer(gampaha, 3, 'OVER_CAPACITY');
    await defer(kadawatha, 4, 'OVER_CAPACITY');
    const latest = await defer(kadawatha, 5, 'OVER_CAPACITY');

    const list = await call(
      w,
      'dispatcher',
      'get',
      `/deferrals?filter[reasonCode]=OVER_CAPACITY&q=${encodeURIComponent(`kadawatha ${sfx}`)}`,
    );
    expect(list.status).toBe(200);
    const rows = data<DeferralDto[]>(list);
    expect(rows.map((d) => d.outletId)).toEqual([kadawatha, kadawatha]);
    expect(rows.find((d) => d.id === latest)).toMatchObject({
      reasonCode: 'OVER_CAPACITY',
      decidedByName: 'Tihara Egodage',
      outletBrand: 'FRESH',
      skips30d: 2,
      recentSkips: 2,
      recentRuns: 5,
    });

    const history = data<DeferralDto[]>(
      await call(
        w,
        'dispatcher',
        'get',
        `/deferrals?filter[outletId]=${gampaha}`,
      ),
    );
    expect(history.map((d) => d.outletId)).toEqual([gampaha]);

    // The depot switch: only that depot's deferrals.
    const atDepot = data<DeferralDto[]>(
      await call(
        w,
        'dispatcher',
        'get',
        `/deferrals?filter[depotId]=${depot.plg}&limit=50`,
      ),
    );
    expect(atDepot).toHaveLength(3);
    expect(
      data<DeferralDto[]>(
        await call(
          w,
          'dispatcher',
          'get',
          `/deferrals?filter[depotId]=${depot.kdy}`,
        ),
      ),
    ).toEqual([]);

    // The store never sees the dispatcher's numbers.
    const mine = data<DeferralDto[]>(
      await call(w, 'store_manager', 'get', '/deferrals?limit=5'),
    );
    expect(mine.length).toBeGreaterThan(0);
    for (const d of mine)
      expect(d).toMatchObject({
        skips30d: null,
        recentSkips: null,
        recentRuns: null,
      });
  });
});
