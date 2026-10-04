import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { and, asc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockSync } from '../../../core/clock/clock-sync.service';
import {
  type ClockMode,
  ClockService,
} from '../../../core/clock/clock.service';
import {
  NotFoundError,
  StateConflictError,
  ValidationError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import {
  GLOBAL_SCOPE,
  SettingsService,
} from '../../../core/settings/settings.service';
import {
  plans,
  simulationInjections,
  simulationRuns,
  stops,
  trips,
} from '../../../db/schema';
import { AuditService } from '../../audit';
import type {
  CreateInjectionDto,
  CreateSimulationDto,
} from '../dto/simulation.dto';
import { SimulationGate } from '../policies/simulation.gate';
import { SimulationScope } from '../policies/simulation.scope';
import {
  DEFAULT_SPEED,
  FAILED_REASONS,
  INJECTION_KINDS,
  LEAD_IN_MINUTES,
  SIMULATION_EVENTS,
} from '../simulation.constants';
import {
  type InjectionRow,
  type RunRow,
  type RunView,
  SimulationQueries,
} from './simulation.queries';

const MIN = 60_000;

/** Trouble to add to a run, from a person or from the director. */
export interface InjectionInput {
  kind: string;
  atSim: Date;
  target: Record<string, unknown>;
  params: Record<string, unknown> | null;
}

/**
 * The run commands (specs/simulation/spec.md, Services). One run at a time
 * holds the demo clock: starting it stores `{ mode: 'simulated', runId, at }`
 * in demo.clock, the worker's loop moves `at` forward, pausing leaves it
 * where it is, and stopping freezes it at the run's last simulated instant.
 */
@Injectable()
export class SimulationService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly gate: SimulationGate,
    private readonly queries: SimulationQueries,
    private readonly scope: SimulationScope,
    private readonly clock: ClockService,
    private readonly clockSync: ClockSync,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(SimulationService.name);
  }

  @Transactional()
  async create(dto: CreateSimulationDto, actor: Actor): Promise<RunView> {
    this.gate.assertEnabled();
    const source = dto.replayOf
      ? await this.queries.get(dto.replayOf, actor)
      : null;
    const planId = dto.planId ?? source?.planId;
    if (!planId) throw new NotFoundError('plan');
    const [plan] = await this.txHost.tx
      .select({ id: plans.id, status: plans.status, date: plans.date })
      .from(plans)
      .where(and(eq(plans.id, planId), this.scope.where(actor)));
    if (!plan) throw new NotFoundError('plan');
    if (plan.status !== 'PUBLISHED')
      throw new StateConflictError('A simulation runs on a published plan.');

    // A replay never asks a model: its trouble is already stored.
    const agentic = !source && dto.agentic === true;
    if (agentic && !(await this.gate.directorOn()))
      throw new StateConflictError('The AI scenario director is off.');

    const [first] = await this.txHost.tx
      .select({ at: trips.plannedDepartAt })
      .from(trips)
      .where(eq(trips.planId, plan.id))
      .orderBy(asc(trips.plannedDepartAt))
      .limit(1);
    const simStartAt = first?.at
      ? new Date(first.at.getTime() - LEAD_IN_MINUTES * MIN)
      : new Date(`${plan.date}T03:00:00+05:30`);

    const [run] = await this.txHost.tx
      .insert(simulationRuns)
      .values({
        scenarioKey: dto.scenario ?? source?.scenarioKey ?? 'normal-day',
        planId: plan.id,
        seed: dto.seed ?? source?.seed ?? 1,
        speed: dto.speed ?? source?.speed ?? DEFAULT_SPEED,
        simStartAt,
        simNow: simStartAt,
        agentic,
        createdById: actor.id,
      })
      .returning();
    if (source?.injections.length)
      await this.txHost.tx.insert(simulationInjections).values(
        source.injections.map((i) => ({
          runId: run.id,
          kind: i.kind,
          atSim: i.atSim,
          target: i.target,
          params: i.params,
          proposedBy: i.proposedBy,
        })),
      );
    await this.record(SIMULATION_EVENTS.created, run, {
      scenario: run.scenarioKey,
      agentic,
      replayOf: source?.id ?? null,
    });
    return this.queries.get(run.id, actor);
  }

  @Transactional()
  async start(id: string, actor: Actor): Promise<RunView> {
    this.gate.assertEnabled();
    const run = await this.queries.get(id, actor);
    this.assertStatus(run, ['DRAFT'], 'started');
    if (await this.queries.holderOfClock(run.id))
      throw new StateConflictError(
        'Another simulation is running. Stop it first.',
      );
    await this.setStatus(run, 'RUNNING');
    await this.setClock(
      { mode: 'simulated', runId: run.id, at: this.iso(run.simStartAt) },
      actor.id,
    );
    await this.record(SIMULATION_EVENTS.started, run, {});
    return this.queries.get(id, actor);
  }

  @Transactional()
  async pause(id: string, actor: Actor): Promise<RunView> {
    this.gate.assertEnabled();
    const run = await this.queries.get(id, actor);
    this.assertStatus(run, ['RUNNING'], 'paused');
    await this.setStatus(run, 'PAUSED');
    await this.record(SIMULATION_EVENTS.paused, run, {});
    return this.queries.get(id, actor);
  }

  @Transactional()
  async resume(id: string, actor: Actor): Promise<RunView> {
    this.gate.assertEnabled();
    const run = await this.queries.get(id, actor);
    this.assertStatus(run, ['PAUSED'], 'resumed');
    await this.setStatus(run, 'RUNNING');
    await this.record(SIMULATION_EVENTS.resumed, run, {});
    return this.queries.get(id, actor);
  }

  /**
   * Ends the run with its numbers. The template writes the report unless the
   * director will: then it stays empty until the worker has the model's.
   */
  @Transactional()
  async stop(id: string, actor: Actor): Promise<RunView> {
    this.gate.assertEnabled();
    const run = await this.queries.get(id, actor);
    this.assertStatus(run, ['RUNNING', 'PAUSED'], 'stopped');
    const kpis = { ...asRecord(run.kpis), ...(await this.queries.kpis(run)) };
    const byDirector = run.agentic && (await this.gate.directorOn());
    await this.txHost.tx
      .update(simulationRuns)
      .set({
        status: 'COMPLETED',
        kpis,
        narrative: byDirector ? null : templateNarrative(run, kpis),
        finishedAt: this.clock.realNow(),
      })
      .where(eq(simulationRuns.id, run.id));
    await this.setClock(
      { mode: 'frozen', at: this.iso(run.simNow ?? run.simStartAt) },
      actor.id,
    );
    await this.record(SIMULATION_EVENTS.stopped, run, { kpis });
    return this.queries.get(id, actor);
  }

  /** Trouble a person adds live (AC-SIM-07). */
  @Transactional()
  async inject(
    id: string,
    dto: CreateInjectionDto,
    actor: Actor,
  ): Promise<InjectionRow> {
    this.gate.assertEnabled();
    const run = await this.queries.get(id, actor);
    this.assertStatus(run, ['DRAFT', 'RUNNING', 'PAUSED'], 'given trouble');
    const input: InjectionInput = {
      kind: dto.kind,
      atSim: new Date(dto.atSim),
      target: dto.target,
      params: dto.params ?? null,
    };
    const problem = await this.problemWith(run, input);
    if (problem)
      throw new ValidationError([
        { field: problem.field, code: 'invalid', message: problem.message },
      ]);
    return this.addInjection(run, input, 'human');
  }

  /**
   * Why this trouble cannot be added to this run, or null. A person's and the
   * director's go through the same check: in the simulated future, of a kind
   * this build carries out, and on the run's own plan.
   */
  async problemWith(
    run: RunRow,
    input: InjectionInput,
  ): Promise<{ field: string; message: string } | null> {
    if (!INJECTION_KINDS.some((kind) => kind === input.kind))
      return { field: 'kind', message: `${input.kind} is not simulated yet` };
    const now = run.simNow ?? run.simStartAt;
    if (Number.isNaN(input.atSim.getTime()) || input.atSim <= now)
      return { field: 'atSim', message: 'Give a simulated time in the future' };
    if (!run.planId) return { field: 'target', message: 'The run has no plan' };

    if (input.kind === 'ROAD_DELAY') {
      const districtId = input.target.districtId;
      if (typeof districtId !== 'string')
        return { field: 'target.districtId', message: 'Give a district' };
      const onPlan = await this.txHost.tx.$count(
        trips,
        and(eq(trips.planId, run.planId), eq(trips.districtId, districtId)),
      );
      if (!onPlan)
        return {
          field: 'target.districtId',
          message: "No trip on the run's plan goes to that district",
        };
      const { speedIndex, minutes } = input.params ?? {};
      if (typeof speedIndex !== 'number' || speedIndex < 10 || speedIndex > 100)
        return { field: 'params.speedIndex', message: 'Between 10 and 100' };
      if (typeof minutes !== 'number' || minutes < 1 || minutes > 480)
        return { field: 'params.minutes', message: 'Between 1 and 480' };
      return null;
    }

    const stopId = input.target.stopId;
    if (typeof stopId !== 'string')
      return { field: 'target.stopId', message: 'Give a stop' };
    const onPlan = await this.txHost.tx
      .select({ id: stops.id })
      .from(stops)
      .innerJoin(trips, eq(trips.id, stops.tripId))
      .where(and(eq(stops.id, stopId), eq(trips.planId, run.planId)));
    if (!onPlan.length)
      return {
        field: 'target.stopId',
        message: "That stop is not on the run's plan",
      };
    const reason = input.params?.reason;
    if (reason !== undefined && !FAILED_REASONS.some((r) => r === reason))
      return {
        field: 'params.reason',
        message: `One of ${FAILED_REASONS.join(', ')}`,
      };
    return null;
  }

  /** Stores checked trouble; call inside a transaction. */
  async addInjection(
    run: RunRow,
    input: InjectionInput,
    proposedBy: 'human' | 'agent',
  ): Promise<InjectionRow> {
    const [row] = await this.txHost.tx
      .insert(simulationInjections)
      .values({
        runId: run.id,
        kind: input.kind as InjectionRow['kind'],
        atSim: input.atSim,
        target: input.target,
        params: input.params,
        proposedBy,
      })
      .returning();
    await this.record(SIMULATION_EVENTS.injectionAdded, run, {
      injectionId: row.id,
      kind: row.kind,
      proposedBy,
    });
    return row;
  }

  /**
   * One step of the loop's bookkeeping: simulated time moves on by
   * `realElapsedMs` at the run's speed, the trouble that has come due fires,
   * and demo.clock follows. Null unless the run is RUNNING.
   */
  @Transactional()
  async advance(id: string, realElapsedMs: number): Promise<RunView | null> {
    const run = await this.queries.load(id);
    if (!run || run.status !== 'RUNNING') return null;
    const from = run.simNow ?? run.simStartAt;
    const simNow = new Date(from.getTime() + realElapsedMs * run.speed);
    await this.txHost.tx
      .update(simulationRuns)
      .set({ simNow })
      .where(eq(simulationRuns.id, run.id));

    const due = await this.txHost.tx
      .select()
      .from(simulationInjections)
      .where(
        and(
          eq(simulationInjections.runId, run.id),
          isNull(simulationInjections.firedAt),
          lte(simulationInjections.atSim, simNow),
        ),
      );
    if (due.length) {
      // firedAt is the simulated instant it was due: the same on every replay.
      for (const injection of due)
        await this.txHost.tx
          .update(simulationInjections)
          .set({ firedAt: injection.atSim, outcome: { fired: true } })
          .where(eq(simulationInjections.id, injection.id));
      for (const injection of due)
        await this.record(SIMULATION_EVENTS.injectionFired, run, {
          injectionId: injection.id,
          kind: injection.kind,
        });
    }
    await this.setClock(
      { mode: 'simulated', runId: run.id, at: this.iso(simNow) },
      null,
      false,
    );
    return this.queries.load(id);
  }

  /** The numbers so far, kept on the run so GET shows them while it plays. */
  @Transactional()
  async refreshKpis(id: string): Promise<void> {
    const run = await this.queries.load(id);
    if (!run) return;
    await this.txHost.tx
      .update(simulationRuns)
      .set({
        kpis: { ...asRecord(run.kpis), ...(await this.queries.kpis(run)) },
      })
      .where(eq(simulationRuns.id, id));
  }

  /** Stores the report of a stopped run. */
  @Transactional()
  async writeNarrative(id: string, narrative: string): Promise<void> {
    await this.txHost.tx
      .update(simulationRuns)
      .set({ narrative })
      .where(
        and(
          eq(simulationRuns.id, id),
          inArray(simulationRuns.status, ['COMPLETED', 'FAILED']),
        ),
      );
  }

  /** The director's turn counter, kept beside the KPIs (the table has no column for it). */
  @Transactional()
  async saveDirectorState(
    id: string,
    state: { calls: number; lastTurnAt: string | null },
  ): Promise<void> {
    const run = await this.queries.load(id);
    if (!run) return;
    await this.txHost.tx
      .update(simulationRuns)
      .set({ kpis: { ...asRecord(run.kpis), director: state } })
      .where(eq(simulationRuns.id, id));
  }

  private assertStatus(run: RunRow, from: RunRow['status'][], verb: string) {
    if (!from.includes(run.status))
      throw new StateConflictError(
        `A ${run.status.toLowerCase()} simulation cannot be ${verb}.`,
      );
  }

  private async setStatus(run: RunRow, status: RunRow['status']) {
    await this.txHost.tx
      .update(simulationRuns)
      .set({ status })
      .where(eq(simulationRuns.id, run.id));
  }

  /**
   * Writes demo.clock and applies it to this process at once; the other
   * processes follow within 5 seconds (ClockSync). A change of mode is
   * announced as clock.changed; the loop's own steps are not, or every second
   * of a run would be an event.
   */
  private async setClock(
    mode: ClockMode,
    actorId: string | null,
    announce = true,
  ): Promise<void> {
    await this.settings.write('demo.clock', mode, GLOBAL_SCOPE, actorId);
    if (announce) {
      await this.audit.record({
        action: 'core.clock.changed',
        entity: ['setting', 'demo.clock'],
        before: this.clock.mode(),
        after: mode,
      });
      await this.outbox.add(
        'clock.changed',
        { v: 1, mode: mode.mode },
        { aggregate: ['setting', 'demo.clock'] },
      );
    }
    this.clockSync.adopt(mode);
  }

  private async record(
    event: string,
    run: RunRow,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      action: event,
      entity: ['simulation_run', run.id],
      after: detail,
      source: 'SIMULATION',
    });
    await this.outbox.add(
      event,
      { v: 1, runId: run.id, ...detail },
      { aggregate: ['simulation_run', run.id] },
    );
    this.log.info({ event, runId: run.id }, 'simulation changed');
  }

  private iso(at: Date): string {
    return this.clock.toIso(at);
  }
}

export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** The report when no model writes one (AC-SIM-08, AC-SIM-10). */
export function templateNarrative(
  run: { scenarioKey: string; planDate: string | null },
  kpis: Record<string, unknown>,
): string {
  const n = (key: string) => (typeof kpis[key] === 'number' ? kpis[key] : 0);
  return `Simulation of ${run.scenarioKey}${run.planDate ? ` on ${run.planDate}` : ''}: ${n('stopsDelivered')} stops delivered, ${n('stopsFailed')} failed, ${n('tripsCompleted')} trips completed, ${n('injections')} injections fired.`;
}
