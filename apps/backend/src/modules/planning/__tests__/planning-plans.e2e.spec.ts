import { and, eq } from 'drizzle-orm';
import { describeWithDb } from '../../../../test/create-test-app';
import { expectProblem, freezeClock } from '../../../../test/kernel';
import { plans, stops, trips } from '../../../db/schema';
import type { PlanDto, TripDto } from '../dto/plan.dto';
import type {
  FixDto,
  OrderOptionDto,
  PlanVehicleOptionDto,
  ValidationResultDto,
} from '../dto/plan-engine.dto';
import { PLANNING_AUDIT } from '../planning.constants';
import {
  auditCount,
  buildWorld,
  call,
  data,
  DAY,
  depotDay,
  OPEN,
  outboxOf,
  tearDown,
  type DepotDay,
  type World,
} from './planning.world';

/** Opens the day's plan and returns it. */
async function open(w: World, day: DepotDay): Promise<PlanDto> {
  const res = await call(
    w,
    'dispatcher',
    'get',
    `/depots/${day.depotId}/plans/${DAY}`,
  );
  expect(res.status).toBe(200);
  return data<PlanDto>(res);
}

/** A trip built on the wizard: ADD_TRIP and its orders, saved as one edit list. */
async function build(
  w: World,
  plan: PlanDto,
  vehicleId: string,
  code: string,
  day: DepotDay,
  orderIds: string[],
) {
  const tripKey = `${code}#1`;
  return call(w, 'dispatcher', 'post', `/plans/${plan.id}/edits`, {
    version: plan.version,
    key: crypto.randomUUID(),
    body: {
      ops: [
        {
          op: 'ADD_TRIP',
          vehicleId,
          tripNo: 1,
          brand: 'FRESH',
          districtId: day.districtId,
        },
        ...orderIds.map((orderId) => ({
          op: 'ASSIGN_ORDER',
          orderId,
          tripKey,
        })),
      ],
    },
  });
}

describeWithDb('planning: plans, the wizard and edits', () => {
  jest.setTimeout(120_000);
  let w: World;

  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(() => tearDown(w));
  afterEach(() => freezeClock(w.app, OPEN));

  it('AC-PLN-08 one plan per depot and date', async () => {
    const day = await depotDay(w);
    const first = await call(
      w,
      'dispatcher',
      'get',
      `/depots/${day.depotId}/plans/2026-10-03`,
    );
    const second = await call(
      w,
      'dispatcher',
      'get',
      `/depots/${day.depotId}/plans/2026-10-03`,
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(data<PlanDto>(second).id).toBe(data<PlanDto>(first).id);
    expect(data<PlanDto>(first)).toMatchObject({
      status: 'DRAFT',
      revision: 0,
    });
    expect(first.headers.etag).toBe('W/"1"');
    const rows = await w.db
      .select()
      .from(plans)
      .where(and(eq(plans.depotId, day.depotId), eq(plans.date, '2026-10-03')));
    expect(rows).toHaveLength(1);
  });

  it('AC-PLN-32 permissions and scope hold', async () => {
    const day = await depotDay(w);
    const plan = await open(w, day);
    expect(
      (await call(w, 'store_manager', 'get', `/plans/${plan.id}`)).status,
    ).toBe(403);
    expect(
      (
        await call(w, 'loader', 'post', `/plans/${plan.id}/engine-runs`, {
          version: 1,
          body: { mode: 'AUTO_SUGGEST', keepLocked: true },
        })
      ).status,
    ).toBe(403);
    expect((await call(w, 'admin', 'get', `/plans/${plan.id}`)).status).toBe(
      200,
    );
    expect(
      (
        await call(w, 'admin', 'post', `/plans/${plan.id}/publish`, {
          version: 1,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          w,
          'driver',
          'post',
          `/plans/${plan.id}/deferrals/decisions`,
          { version: 1, body: { decisions: [] } },
        )
      ).status,
    ).toBe(403);
    expectProblem(
      await call(w, 'kandy', 'get', `/plans/${plan.id}`),
      'NOT_FOUND',
    );
    expectProblem(
      await call(w, 'kandy', 'get', `/depots/${day.depotId}/plans/${DAY}`),
      'NOT_FOUND',
    );
  });

  it('AC-PLN-33 action links follow the rules', async () => {
    const day = await depotDay(w);
    freezeClock(w.app, '2026-10-01T15:59:00+05:30');
    const before = await open(w, day);
    expect(before._links.publish).toBeUndefined();
    expect(before.publishOpensAt).toBe(
      new Date('2026-10-01T16:00:00+05:30').toISOString(),
    );

    freezeClock(w.app, '2026-10-01T16:00:00+05:30');
    const at = data<PlanDto>(
      await call(w, 'dispatcher', 'get', `/plans/${before.id}`),
    );
    expect(at._links.publish).toMatchObject({
      method: 'POST',
    });
    expect(at._links.publish?.requires).toContain('If-Match');
    const admin = data<PlanDto>(
      await call(w, 'admin', 'get', `/plans/${before.id}`),
    );
    expect(admin._links.publish).toBeUndefined();
  });

  it('AC-PLN-13 the wizard saves one edit list', async () => {
    const day = await depotDay(w, {
      a: { volumeM3: 2 },
      b: { volumeM3: 2, outlet: 1 },
      c: { volumeM3: 2, outlet: 2 },
    });
    const plan = await open(w, day);
    const res = await build(w, plan, day.vehicles.ref07, day.codes.ref07, day, [
      day.orders.a,
      day.orders.b,
      day.orders.c,
    ]);
    expect(res.status).toBe(200);
    expect(data<PlanDto>(res)).toMatchObject({
      version: plan.version + 1,
      summary: { trips: 1, plannedOrders: 3 },
    });

    const [trip] = await w.db
      .select()
      .from(trips)
      .where(
        and(eq(trips.planId, plan.id), eq(trips.vehicleId, day.vehicles.ref07)),
      );
    expect(trip).toMatchObject({ locked: true, tripNo: 1, status: 'PLANNED' });
    const laid = await w.db
      .select()
      .from(stops)
      .where(eq(stops.tripId, trip.id));
    expect(laid.map((s) => s.seq).sort()).toEqual([1, 2, 3]);
    expect(
      laid.every(
        (s) => s.plannedArrivalAt && s.windowCloseMin > s.windowOpenMin,
      ),
    ).toBe(true);
    expect(await auditCount(w, PLANNING_AUDIT.planEdited, plan.id)).toBe(1);

    const bad = await call(w, 'dispatcher', 'post', `/plans/${plan.id}/edits`, {
      version: plan.version + 1,
      body: { ops: [{ op: 'TELEPORT', orderId: day.orders.a }] },
    });
    expectProblem(bad, 'VALIDATION_FAILED');
    expect(
      data<PlanDto>(await call(w, 'dispatcher', 'get', `/plans/${plan.id}`))
        .version,
    ).toBe(plan.version + 1);

    const listed = data<TripDto[]>(
      await call(w, 'dispatcher', 'get', `/plans/${plan.id}/trips`),
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      key: `${day.codes.ref07}#1`,
      locked: true,
    });
    expect(listed[0].stops.map((s) => s.orderId)).toEqual([
      day.orders.a,
      day.orders.b,
      day.orders.c,
    ]);
  });

  it('AC-PLN-02 moving onto a full vehicle is refused', async () => {
    const day = await depotDay(w, {
      a: { volumeM3: 6 },
      b: { volumeM3: 5.5, outlet: 1 },
      c: { volumeM3: 0.92, outlet: 2 },
    });
    const plan = await open(w, day);
    await build(w, plan, day.vehicles.ref07, day.codes.ref07, day, [
      day.orders.a,
      day.orders.b,
    ]);
    const v2 = data<PlanDto>(
      await call(w, 'dispatcher', 'get', `/plans/${plan.id}`),
    );
    await call(w, 'dispatcher', 'post', `/plans/${plan.id}/edits`, {
      version: v2.version,
      body: {
        ops: [
          {
            op: 'ADD_TRIP',
            vehicleId: day.vehicles.ref03,
            tripNo: 1,
            brand: 'FRESH',
            districtId: day.districtId,
          },
          {
            op: 'ASSIGN_ORDER',
            orderId: day.orders.c,
            tripKey: `${day.codes.ref03}#1`,
          },
        ],
      },
    });
    const v3 = data<PlanDto>(
      await call(w, 'dispatcher', 'get', `/plans/${plan.id}`),
    );
    const audits = await auditCount(w, PLANNING_AUDIT.planEdited, plan.id);
    const events = (await outboxOf(w, 'plan.edited', plan.id)).length;

    const res = await call(w, 'dispatcher', 'post', `/plans/${plan.id}/edits`, {
      version: v3.version,
      body: {
        ops: [
          {
            op: 'MOVE_ORDER',
            orderId: day.orders.c,
            tripKey: `${day.codes.ref07}#1`,
          },
        ],
      },
    });
    const problem = expectProblem(res, 'PLAN_RULE_VIOLATION');
    expect(res.status).toBe(422);
    const violations = (
      problem as unknown as { violations: Record<string, unknown>[] }
    ).violations;
    expect(violations[0]).toMatchObject({
      rule: 'CAP_VOLUME',
      severity: 'HARD',
      tripKey: `${day.codes.ref07}#1`,
      actual: 12.42,
      limit: 12,
      message: 'Over volume by 0.42 m³',
    });
    expect(
      (problem as unknown as { _links: { fixes: { href: string } } })._links
        .fixes.href,
    ).toBe(`/api/v1/plans/${plan.id}/suggest-fixes`);
    expect(
      data<PlanDto>(await call(w, 'dispatcher', 'get', `/plans/${plan.id}`))
        .version,
    ).toBe(v3.version);
    expect(await auditCount(w, PLANNING_AUDIT.planEdited, plan.id)).toBe(
      audits,
    );
    expect(await outboxOf(w, 'plan.edited', plan.id)).toHaveLength(events);

    const fixes = await call(
      w,
      'dispatcher',
      'post',
      `/plans/${plan.id}/suggest-fixes`,
      {
        body: {
          violation: violations[0],
          ops: [
            {
              op: 'MOVE_ORDER',
              orderId: day.orders.c,
              tripKey: `${day.codes.ref07}#1`,
            },
          ],
        },
      },
    );
    expect(fixes.status).toBe(200);
    const ranked = data<FixDto[]>(fixes);
    expect(ranked.length).toBeGreaterThan(0);
    expect(
      ranked.every(
        (f) => ['MOVE', 'SWAP', 'DEFER'].includes(f.kind) && f.edits.length > 0,
      ),
    ).toBe(true);
  });

  it('AC-PLN-07 a stale If-Match loses', async () => {
    const day = await depotDay(w, { a: { volumeM3: 2, tempClass: 'AMBIENT' } });
    const plan = await open(w, day);
    const ops = [
      {
        op: 'ADD_TRIP',
        vehicleId: day.vehicles.dry31,
        tripNo: 1,
        brand: 'FRESH',
        districtId: day.districtId,
      },
    ];
    expect(
      (
        await call(w, 'dispatcher', 'post', `/plans/${plan.id}/edits`, {
          version: plan.version,
          body: {
            ops: [
              ...ops,
              {
                op: 'ASSIGN_ORDER',
                orderId: day.orders.a,
                tripKey: `${day.codes.dry31}#1`,
              },
            ],
          },
        })
      ).status,
    ).toBe(200);
    const stale = await call(
      w,
      'dispatcher',
      'post',
      `/plans/${plan.id}/edits`,
      {
        version: plan.version,
        body: { ops: [{ op: 'UNASSIGN_ORDER', orderId: day.orders.a }] },
      },
    );
    expectProblem(stale, 'VERSION_MISMATCH');
    expect(stale.status).toBe(412);
    expect(
      data<PlanDto>(await call(w, 'dispatcher', 'get', `/plans/${plan.id}`))
        .version,
    ).toBe(plan.version + 1);
    const none = await call(
      w,
      'dispatcher',
      'post',
      `/plans/${plan.id}/edits`,
      { body: { ops } },
    );
    expectProblem(none, 'PRECONDITION_REQUIRED');
  });

  it('AC-PLN-12 validate never saves', async () => {
    const day = await depotDay(w, {
      a: { volumeM3: 6 },
      b: { volumeM3: 5.5, outlet: 1 },
      c: { volumeM3: 0.92, outlet: 2 },
    });
    const plan = await open(w, day);
    await build(w, plan, day.vehicles.ref07, day.codes.ref07, day, [
      day.orders.a,
      day.orders.b,
    ]);
    const saved = data<PlanDto>(
      await call(w, 'dispatcher', 'get', `/plans/${plan.id}`),
    );
    const audits = await auditCount(w, PLANNING_AUDIT.planEdited, plan.id);

    const res = await call(
      w,
      'dispatcher',
      'post',
      `/plans/${plan.id}/validate`,
      {
        body: {
          ops: [
            {
              op: 'ASSIGN_ORDER',
              orderId: day.orders.c,
              tripKey: `${day.codes.ref07}#1`,
            },
          ],
        },
      },
    );
    expect(res.status).toBe(200);
    const result = data<ValidationResultDto>(res);
    expect(result.violations.map((v) => v.rule)).toContain('CAP_VOLUME');
    expect(result.introduced.map((v) => v.rule)).toContain('CAP_VOLUME');
    expect(
      data<PlanDto>(await call(w, 'dispatcher', 'get', `/plans/${plan.id}`))
        .version,
    ).toBe(saved.version);
    expect(await auditCount(w, PLANNING_AUDIT.planEdited, plan.id)).toBe(
      audits,
    );
  });

  it('AC-PLN-14 a soft rule needs an override', async () => {
    // Window closes at 05:55: a lone stop finishes at 05:45, ten minutes of slack.
    const day = await depotDay(
      w,
      { a: { volumeM3: 1 } },
      { outletWindowClose: [355] },
    );
    const plan = await open(w, day);
    const ops = [
      {
        op: 'ADD_TRIP',
        vehicleId: day.vehicles.ref07,
        tripNo: 1,
        brand: 'FRESH',
        districtId: day.districtId,
      },
      {
        op: 'ASSIGN_ORDER',
        orderId: day.orders.a,
        tripKey: `${day.codes.ref07}#1`,
      },
    ];
    const bare = await call(
      w,
      'dispatcher',
      'post',
      `/plans/${plan.id}/edits`,
      { version: plan.version, body: { ops } },
    );
    const problem = expectProblem(bare, 'PLAN_RULE_VIOLATION') as unknown as {
      violations: { rule: string; severity: string }[];
    };
    expect(problem.violations).toEqual([
      expect.objectContaining({ rule: 'LATE_RISK', severity: 'SOFT' }),
    ]);

    const ok = await call(w, 'dispatcher', 'post', `/plans/${plan.id}/edits`, {
      version: plan.version,
      body: {
        ops,
        reasonCode: 'STORE_REQUEST',
        overrideNote: 'The store opens its dock early for us',
      },
    });
    expect(ok.status).toBe(200);
    expect(
      await auditCount(w, PLANNING_AUDIT.softRuleOverridden, plan.id),
    ).toBe(1);
  });

  it('AC-PLN-15 the wizard shows why', async () => {
    const day = await depotDay(
      w,
      {
        a: { volumeM3: 2 },
        b: { volumeM3: 2, outlet: 1 },
        big: { volumeM3: 13, outlet: 2 },
        dry: { volumeM3: 1, tempClass: 'AMBIENT', outlet: 3 },
      },
      { outletWindowClose: [450, 600] },
    );
    const plan = await open(w, day);
    // REF-07 gets both its trips; the second reaches its outlet after 07:30.
    const setup = await call(
      w,
      'dispatcher',
      'post',
      `/plans/${plan.id}/edits`,
      {
        version: plan.version,
        body: {
          ops: [
            {
              op: 'ADD_TRIP',
              vehicleId: day.vehicles.ref07,
              tripNo: 1,
              brand: 'FRESH',
              districtId: day.districtId,
            },
            {
              op: 'ASSIGN_ORDER',
              orderId: day.orders.a,
              tripKey: `${day.codes.ref07}#1`,
            },
            {
              op: 'ADD_TRIP',
              vehicleId: day.vehicles.ref07,
              tripNo: 2,
              brand: 'FRESH',
              districtId: day.districtId,
            },
            {
              op: 'ASSIGN_ORDER',
              orderId: day.orders.b,
              tripKey: `${day.codes.ref07}#2`,
            },
          ],
        },
      },
    );
    expect(setup.status).toBe(200);

    const vehicles = data<PlanVehicleOptionDto[]>(
      await call(w, 'dispatcher', 'get', `/plans/${plan.id}/vehicle-options`),
    );
    const byId = new Map(vehicles.map((v) => [v.vehicleId, v]));
    expect(byId.get(day.vehicles.workshop)).toMatchObject({
      available: false,
      unavailableReason: 'WORKSHOP',
      status: 'WORKSHOP',
    });
    expect(byId.get(day.vehicles.ref07)).toMatchObject({
      tripsLeft: 0,
      status: 'NO_TRIPS_LEFT',
    });
    expect(byId.get(day.vehicles.dry31)).toMatchObject({
      tripsLeft: 2,
    });
    expect(byId.get(day.vehicles.dry31)?.fuelLeftL).toBeGreaterThan(0);

    const options = data<OrderOptionDto[]>(
      await call(
        w,
        'dispatcher',
        'get',
        `/plans/${plan.id}/order-options?vehicleId=${day.vehicles.ref03}&tripNo=1`,
      ),
    );
    const statuses = options.map((o) => o.status);
    expect(statuses.indexOf('BLOCKED')).toBeGreaterThan(
      statuses.lastIndexOf('FITS'),
    );
    const big = options.find((o) => o.orderId === day.orders.big);
    expect(big).toMatchObject({
      status: 'BLOCKED',
      blocking: [expect.objectContaining({ rule: 'CAP_VOLUME' })],
    });
  });

  it('serves the engine context the web validates with', async () => {
    const day = await depotDay(w, { a: { volumeM3: 2 } });
    const plan = await open(w, day);
    const res = await call(w, 'dispatcher', 'get', `/plans/${plan.id}/context`);
    expect(res.status).toBe(200);
    const ctx = data<{
      input: { orders: { id: string }[]; vehicles: unknown[]; date: string };
      plan: { unplanned: { orderId: string }[] };
    }>(res);
    expect(ctx.input.date).toBe(DAY);
    expect(ctx.input.orders.map((o) => o.id)).toEqual([day.orders.a]);
    expect(ctx.input.vehicles).toHaveLength(4);
    expect(ctx.plan.unplanned.map((u) => u.orderId)).toEqual([day.orders.a]);
  });
});
