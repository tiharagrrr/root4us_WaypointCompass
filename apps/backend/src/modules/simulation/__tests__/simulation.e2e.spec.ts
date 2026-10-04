import '../../../../test/simulation-mode';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { expectProblem } from '../../../../test/kernel';
import { describeWithDb } from '../../../../test/create-test-app';
import { execution } from '../../../../test/worlds';
import { AppConfig } from '../../../config/app-config';
import { ClockService } from '../../../core/clock/clock.service';
import { LLM_PROVIDER, type LlmProvider } from '../../../core/providers/ports';
import {
  auditEvents,
  deliveryLines,
  orders,
  outboxEvents,
  settings,
  simulationInjections,
  simulationRuns,
  stopEvents,
  stops,
  trips,
} from '../../../db/schema';
import { DIRECTOR_MAX_CALLS, RECEIVER_NAMES } from '../simulation.constants';
import { SimulationDirector } from '../services/simulation-director.service';
import { SimulationRunner } from '../services/simulation-runner.service';

const { buildWorld, call, data, resetTrips, seedTrip, tearDownWorld } =
  execution;
type World = execution.World;
type SeededTrip = execution.SeededTrip;

interface RunView {
  id: string;
  status: string;
  agentic: boolean;
  simStartAt: string;
  simNow: string | null;
  narrative: string | null;
  kpis: Record<string, unknown> | null;
  _links: Record<string, { href: string }>;
}

const DATE = '2026-10-02';
const at = (time: string) => new Date(`${DATE}T${time}:00+05:30`);
const MIN = 60_000;

/**
 * The simulator on execution's hand-made world: REF-07 with three stops on the published plan
 * for 2 Oct 2026. The suite calls SimulationRunner.tick itself, which is what the worker's loop
 * does once a second, so simulated time moves only when a test says so. demo.clock and
 * simulation.aiDirector are shared global rows: both are restored afterwards.
 */
describeWithDb('simulation', () => {
  jest.setTimeout(60_000);

  let world: World;
  let runner: SimulationRunner;
  let director: SimulationDirector;
  let llm: LlmProvider;
  let saved: (typeof settings.$inferSelect)[] = [];
  let trip: SeededTrip;

  const sharedSettings = inArray(settings.key, [
    'demo.clock',
    'simulation.aiDirector',
  ]);
  const runRow = async (id: string) =>
    (
      await world.db
        .select()
        .from(simulationRuns)
        .where(eq(simulationRuns.id, id))
    )[0];
  const injectionsOf = (runId: string) =>
    world.db
      .select()
      .from(simulationInjections)
      .where(eq(simulationInjections.runId, runId))
      .orderBy(asc(simulationInjections.atSim));
  const eventsOf = (tripId: string) =>
    world.db
      .select()
      .from(stopEvents)
      .where(eq(stopEvents.tripId, tripId))
      .orderBy(asc(stopEvents.occurredAt), asc(stopEvents.id));
  const setDirector = (on: boolean) =>
    world.db
      .insert(settings)
      .values({ key: 'simulation.aiDirector', scope: 'global', value: on })
      .onConflictDoUpdate({
        target: [settings.key, settings.scope],
        set: { value: on },
      });

  /** REF-07's run: three stops half an hour apart, each a 20-minute leg. */
  async function seedRun(): Promise<SeededTrip> {
    const seeded = await seedTrip(world, { stops: 3, date: DATE });
    const times = ['04:00', '04:30', '05:00'];
    for (const [i, stopId] of seeded.stopIds.entries())
      await world.db
        .update(stops)
        .set({ plannedArrivalAt: at(times[i]), plannedTravelMin: 20 })
        .where(eq(stops.id, stopId));
    return seeded;
  }

  /** Puts the trip back as seeded, as POST /demo/reset would, keeping its ids. */
  async function rewind(seeded: SeededTrip): Promise<void> {
    await world.db
      .delete(deliveryLines)
      .where(inArray(deliveryLines.stopId, seeded.stopIds));
    await world.db
      .delete(stopEvents)
      .where(eq(stopEvents.tripId, seeded.tripId));
    await world.db
      .update(stops)
      .set({
        status: 'PENDING',
        arrivedAt: null,
        completedAt: null,
        outcome: null,
        receiverName: null,
        unitsDelivered: null,
        exceptionNote: null,
      })
      .where(inArray(stops.id, seeded.stopIds));
    await world.db
      .update(trips)
      .set({ status: 'RELEASED', startedAt: null, completedAt: null })
      .where(eq(trips.id, seeded.tripId));
    await world.db
      .update(orders)
      .set({ status: 'LOADED' })
      .where(inArray(orders.id, seeded.orderIds));
  }

  const create = (body: Record<string, unknown> = {}) =>
    call(world, 'dispatcher', 'post', '/simulations').send({
      scenario: 'normal-day',
      planId: trip.planId,
      seed: 42,
      speed: 60,
      ...body,
    });
  const act = (id: string, verb: string) =>
    call(world, 'dispatcher', 'post', `/simulations/${id}/${verb}`).send({});
  const view = async (id: string) =>
    data<RunView>(
      await call(world, 'dispatcher', 'get', `/simulations/${id}`).expect(200),
    );
  async function started(body: Record<string, unknown> = {}): Promise<RunView> {
    const run = data<RunView>(await create(body).expect(201));
    await act(run.id, 'start').expect(200);
    return run;
  }
  /** Moves the run's simulated clock on by this many simulated minutes. */
  const advance = (id: string, simMinutes: number) =>
    runner.tick(id, simMinutes * 1000);

  beforeAll(async () => {
    world = await buildWorld();
    runner = world.app.get(SimulationRunner);
    director = world.app.get(SimulationDirector);
    llm = world.app.get<LlmProvider>(LLM_PROVIDER);
    saved = await world.db.select().from(settings).where(sharedSettings);
  });

  beforeEach(async () => {
    await world.db
      .update(simulationRuns)
      .set({ status: 'FAILED' })
      .where(inArray(simulationRuns.status, ['RUNNING', 'PAUSED']));
    await resetTrips(world);
    world.app.get(ClockService).reset();
    await setDirector(false);
    trip = await seedRun();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await world.db
      .update(simulationRuns)
      .set({ status: 'FAILED' })
      .where(inArray(simulationRuns.status, ['RUNNING', 'PAUSED']));
    await world.db.delete(settings).where(sharedSettings);
    if (saved.length) await world.db.insert(settings).values(saved);
    await tearDownWorld(world);
  });

  it('AC-SIM-01 runs only in demo mode, for simulation:run', async () => {
    const clock = world.app.get(ClockService);
    const runs = () =>
      world.db.$count(simulationRuns, eq(simulationRuns.planId, trip.planId));

    jest
      .spyOn(AppConfig.prototype, 'simulation', 'get')
      .mockReturnValue({ enabled: false });
    expectProblem(await create().expect(404), 'NOT_FOUND');
    expect(await runs()).toBe(0);
    expect(clock.mode()).toEqual({ mode: 'real' });
    jest.restoreAllMocks();

    jest
      .spyOn(AppConfig.prototype, 'demo', 'get')
      .mockReturnValue({ enabled: false, clock: undefined });
    expectProblem(await create().expect(404), 'NOT_FOUND');
    expect(await runs()).toBe(0);
    expect(clock.mode()).toEqual({ mode: 'real' });
    jest.restoreAllMocks();

    for (const role of ['store', 'aniqa', 'loader'] as const)
      expectProblem(
        await call(world, role, 'post', '/simulations')
          .send({ scenario: 'normal-day', planId: trip.planId, seed: 42 })
          .expect(403),
        'FORBIDDEN',
      );
    expect(await runs()).toBe(0);
  });

  it('AC-SIM-02 create and start a run', async () => {
    const clock = world.app.get(ClockService);
    const clockEvents = () =>
      world.db.$count(outboxEvents, eq(outboxEvents.type, 'clock.changed'));

    const created = await create().expect(201);
    const run = data<RunView>(created);
    expect(created.headers.location).toBe(`/api/v1/simulations/${run.id}`);
    expect(run.status).toBe('DRAFT');
    expect(run._links.start).toBeDefined();
    expect(run._links.stop).toBeUndefined();

    const events = await clockEvents();
    const running = data<RunView>(await act(run.id, 'start').expect(200));
    expect(running.status).toBe('RUNNING');
    expect(running._links.start).toBeUndefined();
    expect(running._links.pause).toBeDefined();
    expect(clock.mode()).toMatchObject({ mode: 'simulated', runId: run.id });
    expect(await clockEvents()).toBe(events + 1);

    // Four real minutes at 60x.
    await runner.tick(run.id, 4 * MIN);
    const after = await view(run.id);
    expect(Date.parse(after.simNow!) - Date.parse(after.simStartAt)).toBe(
      4 * 60 * MIN,
    );
    expect(after.status).toBe('RUNNING');
    expect(after.kpis).toMatchObject({ stopsDelivered: 3, stopsFailed: 0 });

    await act(run.id, 'pause').expect(200);
    await runner.tick(run.id, MIN);
    expect((await view(run.id)).simNow).toBe(after.simNow);

    await act(run.id, 'resume').expect(200);
    await runner.tick(run.id, 1000);
    expect(Date.parse((await view(run.id)).simNow!)).toBe(
      Date.parse(after.simNow!) + MIN,
    );
  });

  it('AC-SIM-04 virtual drivers use the real endpoints (field events; pings wait for ROO-37)', async () => {
    const run = await started();
    // To 03:29: REF-07 leaves at 03:30.
    await advance(run.id, 9);
    expect((await eventsOf(trip.tripId)).length).toBe(0);

    await advance(run.id, 60);
    const events = await eventsOf(trip.tripId);
    expect(events.map((e) => e.type).slice(0, 3)).toEqual([
      'TRIP_STARTED',
      'ARRIVED',
      'DELIVERED',
    ]);
    expect(events[0].occurredAt).toEqual(at('03:30'));
    const delivered = events.filter((e) => e.type === 'DELIVERED');
    expect(delivered.length).toBeGreaterThan(0);
    for (const event of delivered)
      expect(RECEIVER_NAMES).toContain(
        (event.payload as { receiverName: string }).receiverName,
      );

    const audit = await world.db
      .select({ source: auditEvents.source })
      .from(auditEvents)
      .where(
        and(
          inArray(auditEvents.entityId, [trip.tripId, ...trip.stopIds]),
          inArray(
            auditEvents.clientUuid,
            events.map((e) => e.clientUuid),
          ),
        ),
      );
    expect(audit.length).toBeGreaterThan(0);
    expect(new Set(audit.map((a) => a.source))).toEqual(
      new Set(['SIMULATION']),
    );
    expect((await execution.outboxRows(world, 'stop.completed')).length).toBe(
      delivered.length,
    );
  });

  it('AC-SIM-07 trouble added live fires on time', async () => {
    const run = await started();
    await advance(run.id, 20); // 03:40
    const injected = await call(
      world,
      'dispatcher',
      'post',
      `/simulations/${run.id}/injections`,
    )
      .send({
        kind: 'ROAD_DELAY',
        atSim: at('03:50').toISOString(),
        target: { districtId: world.depot.plgDistrict },
        params: { speedIndex: 55, minutes: 60 },
      })
      .expect(201);
    expect(data<{ proposedBy: string }>(injected).proposedBy).toBe('human');
    let [row] = await injectionsOf(run.id);
    expect(row).toMatchObject({ proposedBy: 'human', firedAt: null });

    await advance(run.id, 9); // 03:49
    expect((await injectionsOf(run.id))[0].firedAt).toBeNull();

    await advance(run.id, 60); // 04:49
    [row] = await injectionsOf(run.id);
    expect(row.firedAt).toEqual(at('03:50'));
    // A 20-minute leg at speed index 55 takes 36: the first stop is 16 minutes late.
    const first = await execution.stopRow(world, trip.stopIds[0]);
    expect(first.arrivedAt).toEqual(at('04:16'));

    await call(world, 'dispatcher', 'post', `/simulations/${run.id}/injections`)
      .send({
        kind: 'ROAD_DELAY',
        atSim: at('03:00').toISOString(),
        target: { districtId: world.depot.plgDistrict },
        params: { speedIndex: 55, minutes: 60 },
      })
      .expect(400);
  });

  it('AC-SIM-09 (stretch) director decisions are ordinary injections', async () => {
    await setDirector(true);
    const complete = jest.spyOn(llm, 'complete');
    complete.mockImplementation((request) =>
      Promise.resolve(
        request.tools?.length
          ? {
              provider: 'test',
              text: '',
              toolCalls:
                complete.mock.calls.length === 1
                  ? [
                      {
                        name: 'inject_road_delay',
                        input: {
                          districtId: world.depot.plgDistrict,
                          speedIndex: 55,
                          minutes: 60,
                        },
                      },
                    ]
                  : [{ name: 'noop', input: { reason: 'on plan' } }],
            }
          : { provider: 'test', text: 'The director’s report.', toolCalls: [] },
      ),
    );

    const run = await started({ agentic: true });
    expect((await view(run.id)).agentic).toBe(true);
    await advance(run.id, 19);
    expect(complete).not.toHaveBeenCalled();
    await advance(run.id, 1); // 03:40, the first summary
    expect(complete).toHaveBeenCalledTimes(1);
    // The summary carries ids, codes and times only.
    expect(complete.mock.calls[0][0].prompt).not.toContain('Fresh');

    let rows = await injectionsOf(run.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'ROAD_DELAY',
      proposedBy: 'agent',
      firedAt: null,
      target: { districtId: world.depot.plgDistrict },
    });

    await advance(run.id, 120); // 05:40: fired, and the day is done
    rows = await injectionsOf(run.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].firedAt).not.toBeNull();
    const firstRun = (await eventsOf(trip.tripId)).map((e) => [
      e.type,
      e.stopId,
      e.occurredAt.toISOString(),
    ]);
    expect(firstRun.at(-1)?.[0]).toBe('TRIP_COMPLETED');

    await act(run.id, 'stop').expect(200);
    await runner.tick(run.id, 1000);
    expect((await runRow(run.id)).narrative).toBe('The director’s report.');

    // The replay: the stored injections, the same seed, and no model.
    await rewind(trip);
    const calls = complete.mock.calls.length;
    const replay = await started({ replayOf: run.id });
    expect((await view(replay.id)).agentic).toBe(false);
    expect(
      (await injectionsOf(replay.id)).map((r) => [
        r.kind,
        r.atSim,
        r.target,
        r.params,
        r.proposedBy,
      ]),
    ).toEqual(
      rows.map((r) => [r.kind, r.atSim, r.target, r.params, r.proposedBy]),
    );
    await advance(replay.id, 20);
    await advance(replay.id, 120);
    expect(complete.mock.calls.length).toBe(calls);
    expect(
      (await eventsOf(trip.tripId)).map((e) => [
        e.type,
        e.stopId,
        e.occurredAt.toISOString(),
      ]),
    ).toEqual(firstRun);
  });

  it('AC-SIM-10 (stretch) the director stays inside its guardrails', async () => {
    await setDirector(true);
    const complete = jest.spyOn(llm, 'complete');
    const delay = (input: Record<string, unknown> = {}) => ({
      name: 'inject_road_delay',
      input: {
        districtId: world.depot.plgDistrict,
        speedIndex: 55,
        minutes: 30,
        ...input,
      },
    });
    const run = await started({ agentic: true });
    await advance(run.id, 10); // 03:30

    // In the simulated past, and on a plan that is not the run's.
    expect(
      await director.propose(
        run.id,
        delay({ atSim: at('03:00').toISOString() }),
      ),
    ).toMatchObject({ stored: false });
    expect(
      await director.propose(
        run.id,
        delay({ districtId: world.depot.kdyDistrict }),
      ),
    ).toMatchObject({ stored: false });
    expect(
      await director.propose(run.id, {
        name: 'inject_failed_delivery',
        input: { stopId: crypto.randomUUID(), reason: 'OUTLET_CLOSED' },
      }),
    ).toMatchObject({ stored: false });
    expect(await injectionsOf(run.id)).toHaveLength(0);

    // Two calls in one reply: only the first counts.
    complete.mockResolvedValueOnce({
      provider: 'test',
      text: '',
      toolCalls: [delay(), delay({ minutes: 45 })],
    });
    await advance(run.id, 10); // 03:40
    expect(await injectionsOf(run.id)).toHaveLength(1);
    // The director's only tools write injections; none reaches an endpoint.
    expect(complete.mock.calls[0][0].tools?.map((t) => t.name)).toEqual([
      'inject_road_delay',
      'inject_failed_delivery',
      'noop',
    ]);

    // The budget: once 12 calls are used, no model is asked and nothing is stored.
    const row = await runRow(run.id);
    await world.db
      .update(simulationRuns)
      .set({
        kpis: {
          ...(row.kpis as object),
          director: { calls: DIRECTOR_MAX_CALLS, lastTurnAt: at('03:40') },
        },
      })
      .where(eq(simulationRuns.id, run.id));
    complete.mockClear();
    expect(await director.propose(run.id, delay())).toMatchObject({
      stored: false,
    });
    await advance(run.id, 20); // 04:00
    expect(complete).not.toHaveBeenCalled();
    expect(await injectionsOf(run.id)).toHaveLength(1);
    expect((await view(run.id)).status).toBe('RUNNING');
    await act(run.id, 'stop').expect(200);

    // LLM_PROVIDER=disabled: no director, and the template writes the narrative.
    await rewind(trip);
    const off = await started({ agentic: true });
    jest.spyOn(AppConfig.prototype, 'llm', 'get').mockReturnValue({
      provider: 'disabled',
      apiKey: undefined,
      model: 'none',
      openai: { baseUrl: undefined, apiKey: undefined, model: 'none' },
    });
    complete.mockClear();
    await advance(off.id, 40);
    const stopped = data<RunView>(await act(off.id, 'stop').expect(200));
    await runner.tick(off.id, 1000);
    expect(complete).not.toHaveBeenCalled();
    expect(await injectionsOf(off.id)).toHaveLength(0);
    expect(stopped.status).toBe('COMPLETED');
    expect((await runRow(off.id)).narrative).toMatch(/^Simulation of /);
    expect((await runRow(off.id)).finishedAt).not.toBeNull();
    // With the director off, the collection offers no director link.
    const list = await call(world, 'dispatcher', 'get', '/simulations').expect(
      200,
    );
    expect(
      (list.body as { _links: Record<string, unknown> })._links.director,
    ).toBeUndefined();
  });
});
