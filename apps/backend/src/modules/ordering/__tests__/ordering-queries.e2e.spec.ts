import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem, freezeClock } from '../../../../test/kernel';
import { OrderScope } from '../policies/order.scope';
import {
  buildWorld,
  call,
  data,
  type OrderBody,
  orderRow,
  resetOrders,
  seedOrder,
  tearDownWorld,
  type World,
  write,
} from './ordering.world';

const FRIDAY = '2026-10-02';
const AT_1500 = '2026-10-01T15:00:00+05:30';

interface Page {
  data: OrderBody[];
  meta: { page: { limit: number; offset: number; total: number } };
  _links: Record<string, { href: string }>;
}

const page = (res: { body: unknown }) => res.body as Page;

/**
 * Reading orders: the dispatcher's queue and past orders, the store's own
 * list, the filter whitelist, and what scope and permissions refuse
 * (AC-ORD-29 to 34).
 */
describeWithDb('ordering lists, scope and permissions', () => {
  jest.setTimeout(120_000);

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

  it("AC-ORD-29 dispatcher's order queue (03)", async () => {
    // 30 confirmed Peliyagoda orders for Friday across the world's four
    // outlets; the ones past the first round are backorders of the same run,
    // which the one-per-outlet-date-class rule exempts.
    const outlets = [
      w.outlets.kadawatha,
      w.outlets.otherFresh,
      w.outlets.style,
      w.outlets.tech,
    ];
    for (let i = 0; i < 30; i += 1)
      await seedOrder(w, {
        outletId: outlets[i % outlets.length],
        status: 'CONFIRMED',
        requestedDate: FRIDAY,
        source: i < outlets.length ? 'seed' : 'backorder',
        lines: [{ itemId: itemFor(w, outlets[i % outlets.length]), qty: 1 }],
      });

    const res = await call(
      w,
      'dispatcher',
      'get',
      `/orders?filter[depotId]=${w.depot.plg}&filter[deliveryDate]=${FRIDAY}` +
        '&filter[status]=CONFIRMED&sort=districtId,orderNo&limit=25',
    );

    expect(res.status).toBe(200);
    const body = page(res);
    expect(body.data).toHaveLength(25);
    expect(body.meta.page).toEqual({ limit: 25, offset: 0, total: 30 });
    const keys = body.data.map((o) => `${o.orderNo}`);
    expect([...keys]).toEqual([...keys].sort());
    expect(Object.keys(body._links)).toEqual(
      expect.arrayContaining(['self', 'first', 'next', 'last']),
    );
    expect(body._links.create).toBeUndefined();
    expect(body.data.every((o) => Boolean(o._links.self))).toBe(true);
  });

  it('AC-ORD-30 unlisted filters are refused', async () => {
    const res = await call(w, 'dispatcher', 'get', '/orders?filter[note]=late');

    expect(res.status).toBe(400);
    const problem = expectProblem(res, 'VALIDATION_FAILED');
    expect(JSON.stringify(problem.errors)).toContain('note');
  });

  it('AC-ORD-31 past orders search (04)', async () => {
    await seedOrder(w, {
      outletId: w.outlets.kadawatha,
      status: 'RECEIVED',
      requestedDate: '2026-09-29',
    });
    await seedOrder(w, {
      outletId: w.outlets.kadawatha,
      status: 'RECEIVED',
      requestedDate: '2026-09-30',
    });
    const elsewhere = await seedOrder(w, {
      outletId: w.outlets.otherFresh,
      status: 'RECEIVED',
      requestedDate: '2026-09-29',
    });

    const byName = page(
      await call(w, 'dispatcher', 'get', '/orders?q=kadawatha'),
    );

    expect(byName.data.length).toBeGreaterThanOrEqual(2);
    expect(
      byName.data.every(
        (o) =>
          o.outlet.id === w.outlets.kadawatha ||
          o.orderNo.toLowerCase().includes('kadawatha'),
      ),
    ).toBe(true);
    expect(byName.data.map((o) => o.id)).not.toContain(elsewhere.id);
    expect(byName.data[0]._links.timeline.href).toBe(
      `/api/v1/timelines/order/${byName.data[0].id}`,
    );

    const target = await orderRow(w, elsewhere.id);
    const byNumber = page(
      await call(w, 'dispatcher', 'get', `/orders?q=${target.orderNo}`),
    );
    expect(byNumber.data.map((o) => o.id)).toContain(elsewhere.id);
  });

  it('AC-ORD-32 store sees only its orders', async () => {
    const mine = [
      await seedOrder(w, {
        outletId: w.outlets.kadawatha,
        requestedDate: '2026-09-29',
        status: 'RECEIVED',
      }),
      await seedOrder(w, {
        outletId: w.outlets.kadawatha,
        requestedDate: FRIDAY,
        status: 'SUBMITTED',
      }),
    ];
    await seedOrder(w, {
      outletId: w.outlets.otherFresh,
      requestedDate: FRIDAY,
      status: 'SUBMITTED',
    });

    const path =
      '/orders?filter[requestedDate][gte]=2026-09-01&sort=-requestedDate&limit=10&offset=0';
    const body = page(await call(w, 'store', 'get', path));

    expect(body.data.map((o) => o.id).sort()).toEqual(
      mine.map((o) => o.id).sort(),
    );
    expect(body.data.map((o) => o.requestedDate)).toEqual([
      FRIDAY,
      '2026-09-29',
    ]);
    expect(body.meta.page.total).toBe(2);
    expect(body._links.create).toMatchObject({ method: 'POST' });

    // With OrderScope removed, row-level security still answers for her
    // outlet alone (orders_app_scope in src/db/rls.ts).
    const openScope = page(await withoutOrderScope(w, path));
    expect(openScope.data.map((o) => o.id).sort()).toEqual(
      mine.map((o) => o.id).sort(),
    );
  });

  it('AC-ORD-33 out of scope is 404', async () => {
    const hers = await seedOrder(w, {
      outletId: w.outlets.kadawatha,
      status: 'SUBMITTED',
      requestedDate: FRIDAY,
    });
    const kandy = await seedOrder(w, {
      outletId: w.outlets.kandy,
      status: 'CONFIRMED',
      requestedDate: FRIDAY,
    });
    const template = data<{ id: string }>(
      await call(w, 'store', 'post', '/order-templates').send({
        name: `Scoped ${w.sfx}`,
        tempClass: 'AMBIENT',
        lines: [{ itemId: w.items.dryA, qty: 1 }],
      }),
    );

    // Another outlet's store manager reaches none of it.
    const reads = [
      await call(w, 'otherStore', 'get', `/orders/${hers.id}`),
      await write(w, 'otherStore', 'patch', `/orders/${hers.id}`, 1).send({
        note: 'mine now',
      }),
      await write(w, 'otherStore', 'post', `/orders/${hers.id}/submit`, 1).send(
        {},
      ),
      await write(w, 'otherStore', 'post', `/orders/${hers.id}/cancel`, 1).send(
        { reasonNote: 'not mine' },
      ),
      await call(w, 'otherStore', 'get', `/order-templates/${template.id}`),
    ];
    for (const res of reads) {
      expect(res.status).toBe(404);
      expectProblem(res, 'NOT_FOUND');
    }
    expect(await orderRow(w, hers.id)).toMatchObject({
      status: 'SUBMITTED',
      version: 1,
      note: null,
    });

    // A Peliyagoda dispatcher and loader reach nothing at Kandy.
    const kandyReads = [
      await call(w, 'dispatcher', 'get', `/orders/${kandy.id}`),
      await write(
        w,
        'dispatcher',
        'post',
        `/orders/${kandy.id}/cancel`,
        1,
      ).send({ reasonCode: 'STORE_CLOSED' }),
      await call(w, 'loader', 'get', `/orders/${kandy.id}`),
    ];
    for (const res of kandyReads) {
      expect(res.status).toBe(404);
      expectProblem(res, 'NOT_FOUND');
    }
    expect((await orderRow(w, kandy.id)).status).toBe('CONFIRMED');
  });

  it('AC-ORD-34 a missing permission is 403', async () => {
    const order = await seedOrder(w, {
      outletId: w.outlets.kadawatha,
      status: 'SUBMITTED',
      requestedDate: FRIDAY,
    });
    const line = { itemId: w.items.dryA, qty: 1 };
    const cases: {
      role: Parameters<typeof call>[1];
      method: 'get' | 'post' | 'put' | 'patch';
      path: string;
      body?: Record<string, unknown>;
      permission: string;
    }[] = [
      {
        role: 'dispatcher',
        method: 'post',
        path: '/orders',
        body: { tempClass: 'AMBIENT', requestedDate: FRIDAY, lines: [line] },
        permission: 'order:create',
      },
      {
        role: 'dispatcher',
        method: 'post',
        path: `/orders/${order.id}/submit`,
        permission: 'order:submit',
      },
      {
        role: 'dispatcher',
        method: 'put',
        path: `/orders/${order.id}/lines`,
        body: { lines: [line] },
        permission: 'order:update',
      },
      {
        role: 'dispatcher',
        method: 'get',
        path: '/order-templates',
        permission: 'order:create',
      },
      {
        role: 'dispatcher',
        method: 'get',
        path: `/outlets/${w.outlets.kadawatha}/receiving-roster?date=${FRIDAY}`,
        permission: 'order:update',
      },
      {
        role: 'admin',
        method: 'post',
        path: `/orders/${order.id}/cancel`,
        body: { reasonCode: 'STORE_CLOSED' },
        permission: 'order:cancel',
      },
      {
        role: 'store',
        method: 'patch',
        path: `/orders/${order.id}/priority`,
        body: { urgent: true },
        permission: 'order:queue',
      },
      {
        role: 'store',
        method: 'post',
        path: `/depots/${w.depot.plg}/days/${FRIDAY}/close-cutoff`,
        permission: 'order:queue',
      },
      {
        role: 'loader',
        method: 'post',
        path: '/orders',
        body: { tempClass: 'AMBIENT', requestedDate: FRIDAY, lines: [line] },
        permission: 'order:create',
      },
      {
        role: 'driver',
        method: 'get',
        path: '/orders',
        permission: 'order:read',
      },
    ];

    for (const c of cases) {
      const res = await call(w, c.role, c.method, c.path)
        .set('If-Match', 'W/"1"')
        .send(c.body ?? {});

      expect([c.permission, res.status]).toEqual([c.permission, 403]);
      expectProblem(res, 'FORBIDDEN');
    }
    expect(await orderRow(w, order.id)).toMatchObject({
      status: 'SUBMITTED',
      version: 1,
      urgent: false,
    });
  });
});

/** An item of the brand the outlet sells, so a seeded line is always valid. */
function itemFor(w: World, outletId: string): string {
  if (outletId === w.outlets.style) return w.items.style;
  if (outletId === w.outlets.tech) return w.items.tech;
  return w.items.dryA;
}

/**
 * The same request with OrderScope replaced by "every row", which leaves
 * Postgres's row-level security as the only thing standing between a store
 * manager and another outlet's orders (AC-ORD-32).
 */
async function withoutOrderScope(
  w: World,
  path: string,
): Promise<{ body: unknown }> {
  const scope: { where: OrderScope['where'] } = w.app.get(OrderScope);
  const original = scope.where;
  scope.where = () => undefined;
  try {
    return await call(w, 'store', 'get', path);
  } finally {
    scope.where = original;
  }
}
