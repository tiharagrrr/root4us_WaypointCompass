import { Controller, Get, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, type SQL } from 'drizzle-orm';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import {
  bodyOf,
  browser,
  signedInAs,
  type Problem,
} from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import { depotFixture, outletFixture, suffix } from '../../../../test/fixtures';
import { NO_ROWS, ScopePolicy } from '../../../core/auth/scope-policy';
import { Actor, RequirePermission } from '../../../core/http/decorators';
import { withActor } from '../../../db/actor';
import type { Database } from '../../../db/client';
import { DB } from '../../../db/database.module';
import { orders } from '../../../db/schema';

/**
 * GET /orders/{id} belongs to ordering and does not exist yet, so this test
 * mounts a stand-in with the order scope rule. When ordering ships its route
 * and OrderScope, point this test at the real one.
 */
class OrderScopeFixture extends ScopePolicy {
  protected readonly resource = 'order';

  where(actor: Actor): SQL | undefined {
    switch (actor.role) {
      case 'admin':
        return undefined;
      case 'store_manager':
        return this.sameOutlet(orders.outletId, actor);
      case 'dispatcher':
      case 'loader':
        return this.sameDepot(orders.depotId, actor);
      default:
        return NO_ROWS;
    }
  }
}

@Controller('orders')
class OrdersFixtureController {
  private readonly scope = new OrderScopeFixture();

  constructor(@Inject(DB) private readonly db: Database) {}

  @Get(':id')
  @RequirePermission('order:read')
  async get(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: Actor) {
    const [order] = await withActor(this.db, actor, (tx) =>
      tx
        .select({
          id: orders.id,
          orderNo: orders.orderNo,
          outletId: orders.outletId,
        })
        .from(orders)
        .where(and(eq(orders.id, id), this.scope.where(actor))),
    );
    return this.scope.found(order);
  }
}

describeWithDb('ScopePolicy', () => {
  jest.setTimeout(30_000);

  const sfx = suffix();
  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  let nimeshaCookie: string;
  let ownOrder: string;
  let otherOrder: string;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [OrdersFixtureController] });
    ({ db, close } = ownerDatabase());
    const depot = await depotFixture(db, sfx);
    const inPlg = { depotId: depot.plg, districtId: depot.plgDistrict };
    const kadawatha = await outletFixture(db, `OUT014-${sfx}`, inPlg);
    const other = await outletFixture(db, `OUT015-${sfx}`, inPlg);

    const order = {
      depotId: depot.plg,
      districtId: depot.plgDistrict,
      brand: 'FRESH' as const,
      tempClass: 'CHILLED' as const,
      status: 'SUBMITTED' as const,
      requestedDate: '2026-10-02',
      deliveryDate: '2026-10-02',
    };
    [{ id: ownOrder }, { id: otherOrder }] = await db
      .insert(orders)
      .values([
        { orderNo: `T-${sfx}-1`, outletId: kadawatha, ...order },
        { orderNo: `T-${sfx}-2`, outletId: other, ...order },
      ])
      .returning({ id: orders.id });

    ({ cookie: nimeshaCookie } = await signedInAs(app, db, {
      role: 'store_manager',
      name: 'Nimesha Periyapperuma',
      outletId: kadawatha,
    }));
  });

  afterAll(async () => {
    await close();
    await app.close();
  });

  const getOrder = (id: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/orders/${id}`)
      .set(browser())
      .set('Cookie', nimeshaCookie);

  /** The problem body without the members that name this request. */
  const stable = ({
    instance,
    requestId,
    ...rest
  }: Record<string, unknown>) => {
    expect(instance).toEqual(expect.any(String));
    expect(requestId).toEqual(expect.any(String));
    return rest;
  };

  it("AC-IDN-01 another outlet's order is not found", async () => {
    // Her own outlet's order is visible, so the 404 below is the scope at work.
    const own = await getOrder(ownOrder).expect(200);
    expect(bodyOf<{ data: { id: string } }>(own).data.id).toBe(ownOrder);

    const other = await getOrder(otherOrder);
    expect(other.status).toBe(404);
    expect(other.headers['content-type']).toMatch(
      /^application\/problem\+json/,
    );
    expect(bodyOf<Problem>(other).code).toBe('NOT_FOUND');

    const missing = await getOrder(uuidv7());
    expect(missing.status).toBe(404);
    expect(stable(bodyOf(other))).toEqual(stable(bodyOf(missing)));
  });
});
