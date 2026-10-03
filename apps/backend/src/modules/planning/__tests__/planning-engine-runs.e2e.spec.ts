import { DEFERRAL_REASON_CODES, ENGINE_VERSION } from '@waypoint/engine';
import { and, eq, inArray } from 'drizzle-orm';
import { describeWithDb } from '../../../../test/create-test-app';
import { freezeClock } from '../../../../test/kernel';
import { JobContextRunner } from '../../../core/context/job-context';
import { deferrals, engineRuns, plans, stops, trips } from '../../../db/schema';
import type { EngineRunDto } from '../dto/plan-actions.dto';
import type { ValidationResultDto } from '../dto/plan-engine.dto';
import type { PlanDto } from '../dto/plan.dto';
import { PLANNING_AUDIT } from '../planning.constants';
import { EngineRunner } from '../services/engine-runner.service';
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

/** Eight 4 m³ chilled orders over six outlets: more than the two working reefers carry. */
const busyDay = (w: World) =>
  depotDay(
    w,
    Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [
        `o${i}`,
        { volumeM3: 4, outlet: i % 6 },
      ]),
    ),
  );

const planOf = async (w: World, day: DepotDay) =>
  data<PlanDto>(
    await call(w, 'dispatcher', 'get', `/depots/${day.depotId}/plans/${DAY}`),
  );

/** Starts a run over HTTP and finishes it the way the worker does. */
async function run(
  w: World,
  p: PlanDto,
  keepLocked = true,
): Promise<EngineRunDto> {
  const res = await call(
    w,
    'dispatcher',
    'post',
    `/plans/${p.id}/engine-runs`,
    {
      version: p.version,
      key: crypto.randomUUID(),
      body: { mode: 'AUTO_SUGGEST', keepLocked },
    },
  );
  expect(res.status).toBe(202);
  const started = data<EngineRunDto>(res);
  expect(started.status).toBe('RUNNING');
  await finish(w, started.id, keepLocked);
  return data<EngineRunDto>(
    await call(
      w,
      'dispatcher',
      'get',
      `/plans/${p.id}/engine-runs/${started.id}`,
    ),
  );
}

async function finish(
  w: World,
  runId: string,
  keepLocked: boolean,
): Promise<void> {
  const jobs = w.app.get(JobContextRunner);
  const runner = w.app.get(EngineRunner);
  try {
    await jobs.run({ id: `test:run:${runId}` }, () =>
      runner.complete({ runId, keepLocked }),
    );
  } catch (err) {
    await jobs.run({ id: `test:fail:${runId}` }, () => runner.fail(runId, err));
  }
}

const liveTrips = async (w: World, planId: string) => {
  const rows = await w.db.select().from(trips).where(eq(trips.planId, planId));
  const live = rows.filter((t) => t.status !== 'CANCELLED');
  const laid = live.length
    ? await w.db
        .select()
        .from(stops)
        .where(
          inArray(
            stops.tripId,
            live.map((t) => t.id),
          ),
        )
    : [];
  return live
    .map((t) => ({
      vehicleId: t.vehicleId,
      tripNo: t.tripNo,
      locked: t.locked,
      orderIds: laid
        .filter((s) => s.tripId === t.id && s.status !== 'CANCELLED')
        .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
        .map((s) => s.orderId),
    }))
    .sort((a, b) =>
      `${a.vehicleId}${a.tripNo}`.localeCompare(`${b.vehicleId}${b.tripNo}`),
    );
};

describeWithDb('planning: engine runs', () => {
  jest.setTimeout(120_000);
  let w: World;

  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(() => tearDown(w));
  afterEach(() => freezeClock(w.app, OPEN));

  it('AC-PLN-01 engine run leaves no hard violation', async () => {
    const day = await busyDay(w);
    const p = await planOf(w, day);
    const done = await run(w, p);
    expect(done.status).toBe('SUCCEEDED');

    const checked = data<ValidationResultDto>(
      await call(w, 'dispatcher', 'post', `/plans/${p.id}/validate`, {
        body: {},
      }),
    );
    expect(checked.violations.filter((v) => v.severity === 'HARD')).toEqual([]);

    const onTrips = (await liveTrips(w, p.id)).flatMap((t) => t.orderIds);
    const proposed = await w.db
      .select()
      .from(deferrals)
      .where(and(eq(deferrals.planId, p.id), eq(deferrals.status, 'PROPOSED')));
    const unplanned = proposed.map((d) => d.orderId);
    const all = Object.values(day.orders);
    expect([...onTrips, ...unplanned].sort()).toEqual([...all].sort());
    expect(new Set(onTrips).size).toBe(onTrips.length);
    expect(unplanned.length).toBeGreaterThan(0);
    for (const d of proposed) {
      expect(d.source).toBe('ENGINE');
      expect(DEFERRAL_REASON_CODES).toContain(d.reasonCode);
      expect(['UNAVOIDABLE', 'PRIORITY_CHOICE']).toContain(d.choice);
      expect(d.bindingRule).toBeTruthy();
      expect(d.engineRunId).toBe(done.id);
    }
  });

  it('AC-PLN-09 an engine run records how it ran', async () => {
    const day = await busyDay(w);
    let p = await planOf(w, day);
    const first = await run(w, p);
    expect(first).toMatchObject({
      status: 'SUCCEEDED',
      engineVersion: ENGINE_VERSION,
    });
    expect(typeof first.servedCount).toBe('number');
    expect(typeof first.deferredCount).toBe('number');
    expect(first.finishedAt).toBeTruthy();
    expect(first.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect((first.stats as { limiting: unknown[] }).limiting).toEqual(
      expect.any(Array),
    );
    expect(
      await auditCount(w, PLANNING_AUDIT.engineRunCompleted, first.id),
    ).toBe(1);
    expect(await outboxOf(w, 'plan.engine_run.completed', p.id)).toHaveLength(
      1,
    );
    const trips1 = await liveTrips(w, p.id);

    p = data<PlanDto>(await call(w, 'dispatcher', 'get', `/plans/${p.id}`));
    const second = await run(w, p);
    expect(second.inputHash).toBe(first.inputHash);
    expect(await liveTrips(w, p.id)).toEqual(trips1);
    expect(second.deferredCount).toBe(first.deferredCount);
  });

  it('AC-PLN-10 hand-built trips survive Auto-suggest', async () => {
    const day = await depotDay(w, {
      dryA: { volumeM3: 2, tempClass: 'AMBIENT' },
      dryB: { volumeM3: 2, tempClass: 'AMBIENT', outlet: 1 },
      chilled: { volumeM3: 3, outlet: 2 },
    });
    const p = await planOf(w, day);
    const key = `${day.codes.dry31}#1`;
    const built = await call(w, 'dispatcher', 'post', `/plans/${p.id}/edits`, {
      version: p.version,
      body: {
        ops: [
          {
            op: 'ADD_TRIP',
            vehicleId: day.vehicles.dry31,
            tripNo: 1,
            brand: 'FRESH',
            districtId: day.districtId,
          },
          { op: 'ASSIGN_ORDER', orderId: day.orders.dryB, tripKey: key },
          { op: 'ASSIGN_ORDER', orderId: day.orders.dryA, tripKey: key },
        ],
      },
    });
    expect(built.status).toBe(200);

    await run(w, data<PlanDto>(built), true);
    const kept = (await liveTrips(w, p.id)).find(
      (t) => t.vehicleId === day.vehicles.dry31 && t.tripNo === 1,
    );
    expect(kept).toMatchObject({
      locked: true,
      orderIds: [day.orders.dryB, day.orders.dryA],
    });
    const others = (await liveTrips(w, p.id))
      .filter((t) => t !== kept)
      .flatMap((t) => t.orderIds);
    expect(others).toContain(day.orders.chilled);
  });

  it('AC-PLN-11 a failed run changes nothing', async () => {
    const day = await busyDay(w);
    const p = await planOf(w, day);
    await run(w, p);
    const before = await liveTrips(w, p.id);
    const current = data<PlanDto>(
      await call(w, 'dispatcher', 'get', `/plans/${p.id}`),
    );

    const res = await call(
      w,
      'dispatcher',
      'post',
      `/plans/${p.id}/engine-runs`,
      {
        version: current.version,
        body: { mode: 'AUTO_SUGGEST', keepLocked: true },
      },
    );
    const started = data<EngineRunDto>(res);
    // The plan stops being a draft before the worker picks the run up.
    await w.db
      .update(plans)
      .set({ status: 'CLOSED' })
      .where(eq(plans.id, p.id));
    await finish(w, started.id, true);

    const [failed] = await w.db
      .select()
      .from(engineRuns)
      .where(eq(engineRuns.id, started.id));
    expect(failed).toMatchObject({ status: 'FAILED' });
    expect(failed.error).toBeTruthy();
    expect(failed.finishedAt).toBeTruthy();
    expect(await outboxOf(w, 'plan.engine_run.failed', p.id)).toHaveLength(1);
    expect(await liveTrips(w, p.id)).toEqual(before);
  });

  it('refuses a repair run on a draft', async () => {
    const day = await depotDay(w);
    const p = await planOf(w, day);
    const res = await call(
      w,
      'dispatcher',
      'post',
      `/plans/${p.id}/engine-runs`,
      {
        version: p.version,
        body: { mode: 'REPAIR', keepLocked: true },
      },
    );
    expect(res.status).toBe(409);
  });
});
