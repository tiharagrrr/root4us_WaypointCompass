import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { ClockService } from '../../../core/clock/clock.service';
import { JobContextRunner } from '../../../core/context/job-context';
import type { LlmTool, LlmToolCall } from '../../../core/providers/ports';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { stops, trips, vehicles } from '../../../db/schema';
import { SimulationGate } from '../policies/simulation.gate';
import {
  DIRECTOR_INTERVAL_MINUTES,
  DIRECTOR_MAX_CALLS,
  DIRECTOR_PROMPT,
  FAILED_REASONS,
  NARRATIVE_PROMPT,
  SIMULATION_LOGS,
} from '../simulation.constants';
import { type RunView, SimulationQueries } from './simulation.queries';
import {
  asRecord,
  type InjectionInput,
  SimulationService,
  templateNarrative,
} from './simulation.service';

const MIN = 60_000;

const atSim = {
  type: ['string', 'null'],
  description:
    'Simulated time to fire, ISO 8601, later than simNow; null to act now',
};

/** Everything the director can do: add trouble to its own run, or nothing (AC-SIM-10). */
export const DIRECTOR_TOOLS: LlmTool[] = [
  {
    name: 'inject_road_delay',
    description:
      'Traffic slows in one district of the plan: legs that start during the delay take longer.',
    inputSchema: {
      type: 'object',
      properties: {
        districtId: {
          type: 'string',
          description: 'A districtId from the state',
        },
        speedIndex: {
          type: 'integer',
          description: 'Percent of normal speed, 10 to 100',
        },
        minutes: {
          type: 'integer',
          description: 'How long it lasts, 1 to 480',
        },
        atSim,
      },
      required: ['districtId', 'speedIndex', 'minutes', 'atSim'],
      additionalProperties: false,
    },
  },
  {
    name: 'inject_failed_delivery',
    description: 'The next delivery at one stop of the plan fails.',
    inputSchema: {
      type: 'object',
      properties: {
        stopId: { type: 'string', description: 'A nextStopId from the state' },
        reason: { type: 'string', enum: [...FAILED_REASONS] },
        atSim,
      },
      required: ['stopId', 'reason', 'atSim'],
      additionalProperties: false,
    },
  },
  {
    name: 'noop',
    description: 'Let the day run.',
    inputSchema: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
      additionalProperties: false,
    },
  },
];

const when = z.string().nullish();
const roadDelay = z.object({
  districtId: z.string(),
  speedIndex: z.number(),
  minutes: z.number(),
  atSim: when,
});
const failedDelivery = z.object({
  stopId: z.string(),
  reason: z.enum(FAILED_REASONS).optional(),
  atSim: when,
});

interface DirectorState {
  calls: number;
  lastTurnAt: string | null;
}

export interface Proposal {
  stored: boolean;
  /** Why not, for the log: noop, budget, or what was wrong with it. */
  reason?: string;
}

/**
 * The agentic scenario director (stretch; specs/simulation/spec.md). Every 20
 * simulated minutes it gets a compact state of the day and may call one tool.
 * A call becomes an ordinary simulation_injections row with proposedBy
 * `agent`, checked and carried out exactly like a person's, so a replay needs
 * no model. It has a budget of 12 calls, a fixed prompt, and no tool that
 * reaches an endpoint. The state carries ids, vehicle codes, statuses and
 * times only: no outlet, address, item or volume.
 */
@Injectable()
export class SimulationDirector {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly gate: SimulationGate,
    private readonly jobs: JobContextRunner,
    private readonly queries: SimulationQueries,
    private readonly runs: SimulationService,
    private readonly clock: ClockService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(SimulationDirector.name);
  }

  /** Asks the model for this run's next move, when one is due. */
  async turn(runId: string): Promise<void> {
    const run = await this.load(runId);
    if (!run?.agentic || run.status !== 'RUNNING' || !run.simNow) return;
    const model = (await this.directorOn()) ? this.gate.model : null;
    if (!model) return;
    const state = stateOf(run);
    if (state.calls >= DIRECTOR_MAX_CALLS) return;
    const last = state.lastTurnAt ? new Date(state.lastTurnAt) : run.simStartAt;
    if (run.simNow.getTime() - last.getTime() < DIRECTOR_INTERVAL_MINUTES * MIN)
      return;

    await this.runs.saveDirectorState(run.id, {
      ...state,
      lastTurnAt: run.simNow.toISOString(),
    });
    let call: LlmToolCall | undefined;
    try {
      const reply = await model.complete({
        system: DIRECTOR_PROMPT,
        prompt: JSON.stringify(await this.summary(run, state)),
        tools: DIRECTOR_TOOLS,
      });
      // One tool a turn, whatever came back.
      call = reply.toolCalls[0];
    } catch (error: unknown) {
      this.log.warn(
        { event: SIMULATION_LOGS.directorFailed, runId: run.id, err: error },
        'director turn failed',
      );
      return;
    }
    if (!call) return;
    const proposal = await this.propose(run.id, call);
    this.log.info(
      {
        event: proposal.stored
          ? SIMULATION_LOGS.directorTurn
          : SIMULATION_LOGS.directorRejected,
        runId: run.id,
        tool: call.name,
        reason: proposal.reason,
      },
      'director turn',
    );
  }

  /**
   * One tool call from the director. It always spends one of the run's 12
   * calls; it is stored only when the budget allows it, the tool is one of
   * ours and the trouble passes the same check as a person's.
   */
  propose(runId: string, call: LlmToolCall): Promise<Proposal> {
    return this.jobs.run({ id: `simulation:${runId}` }, () =>
      this.decide(runId, call),
    );
  }

  private async decide(runId: string, call: LlmToolCall): Promise<Proposal> {
    const run = await this.queries.load(runId);
    if (!run || run.status !== 'RUNNING' || !run.agentic)
      return { stored: false, reason: 'not running' };
    const state = stateOf(run);
    if (state.calls >= DIRECTOR_MAX_CALLS)
      return { stored: false, reason: 'budget' };
    await this.runs.saveDirectorState(run.id, {
      ...state,
      calls: state.calls + 1,
    });
    if (call.name === 'noop') return { stored: false, reason: 'noop' };

    const input = this.toInjection(run, call);
    if (!input) return { stored: false, reason: 'invalid tool call' };
    const problem = await this.runs.problemWith(run, input);
    if (problem)
      return { stored: false, reason: `${problem.field}: ${problem.message}` };
    await this.runs.addInjection(run, input, 'agent');
    return { stored: true };
  }

  /** The stopped run's report: the model's, or the template's when it has none to give. */
  async narrate(runId: string): Promise<void> {
    const run = await this.load(runId);
    if (!run || run.status !== 'COMPLETED' || !run.agentic || run.narrative)
      return;
    const kpis = asRecord(run.kpis);
    let text = '';
    const model = (await this.directorOn()) ? this.gate.model : null;
    if (model)
      try {
        const reply = await model.complete({
          system: NARRATIVE_PROMPT,
          prompt: JSON.stringify({
            scenario: run.scenarioKey,
            date: run.planDate,
            kpis: { ...kpis, director: undefined },
            injections: run.injections.map((i) => ({
              kind: i.kind,
              atSim: this.clock.toIso(i.atSim),
              proposedBy: i.proposedBy,
              fired: i.firedAt !== null,
            })),
          }),
        });
        text = reply.text.trim();
      } catch (error: unknown) {
        this.log.warn(
          { event: SIMULATION_LOGS.directorFailed, runId: run.id, err: error },
          'director report failed',
        );
      }
    await this.runs.writeNarrative(
      run.id,
      text || templateNarrative(run, kpis),
    );
  }

  @Transactional()
  private load(runId: string): Promise<RunView | null> {
    return this.queries.load(runId);
  }

  @Transactional()
  private directorOn(): Promise<boolean> {
    return this.gate.directorOn();
  }

  private toInjection(run: RunView, call: LlmToolCall): InjectionInput | null {
    const now = run.simNow ?? run.simStartAt;
    const at = (value: string | null | undefined) =>
      value ? new Date(value) : new Date(now.getTime() + MIN);
    if (call.name === 'inject_road_delay') {
      const parsed = roadDelay.safeParse(call.input);
      if (!parsed.success) return null;
      const { districtId, speedIndex, minutes } = parsed.data;
      return {
        kind: 'ROAD_DELAY',
        atSim: at(parsed.data.atSim),
        target: { districtId },
        params: { speedIndex, minutes },
      };
    }
    if (call.name === 'inject_failed_delivery') {
      const parsed = failedDelivery.safeParse(call.input);
      if (!parsed.success) return null;
      return {
        kind: 'FAILED_DELIVERY',
        atSim: at(parsed.data.atSim),
        target: { stopId: parsed.data.stopId },
        params: { reason: parsed.data.reason ?? 'OUTLET_CLOSED' },
      };
    }
    return null;
  }

  /** What the model sees: the day in ids, codes, statuses and times. */
  @Transactional()
  private async summary(run: RunView, state: DirectorState) {
    const now = run.simNow ?? run.simStartAt;
    const tripRows = run.planId
      ? await this.txHost.tx
          .select({
            id: trips.id,
            status: trips.status,
            districtId: trips.districtId,
            vehicle: vehicles.code,
            plannedDepartAt: trips.plannedDepartAt,
          })
          .from(trips)
          .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
          .where(
            and(
              eq(trips.planId, run.planId),
              inArray(trips.status, ['RELEASED', 'IN_PROGRESS', 'COMPLETED']),
            ),
          )
          .orderBy(asc(trips.plannedDepartAt))
      : [];
    const stopRows = tripRows.length
      ? await this.txHost.tx
          .select({
            id: stops.id,
            tripId: stops.tripId,
            status: stops.status,
            plannedArrivalAt: stops.plannedArrivalAt,
          })
          .from(stops)
          .where(
            inArray(
              stops.tripId,
              tripRows.map((t) => t.id),
            ),
          )
          .orderBy(asc(stops.seq))
      : [];
    return {
      simNow: this.clock.toIso(now),
      callsLeft: DIRECTOR_MAX_CALLS - state.calls,
      trips: tripRows.map((trip) => {
        const open = stopRows.filter(
          (s) =>
            s.tripId === trip.id &&
            (s.status === 'PENDING' || s.status === 'ARRIVED'),
        );
        const next = open[0];
        return {
          tripId: trip.id,
          vehicle: trip.vehicle,
          districtId: trip.districtId,
          status: trip.status,
          departsAt: trip.plannedDepartAt
            ? this.clock.toIso(trip.plannedDepartAt)
            : null,
          stopsLeft: open.length,
          nextStopId: next?.id ?? null,
          lateMinutes:
            next?.plannedArrivalAt && next.plannedArrivalAt < now
              ? Math.round(
                  (now.getTime() - next.plannedArrivalAt.getTime()) / MIN,
                )
              : 0,
        };
      }),
      injected: run.injections.map((i) => ({
        kind: i.kind,
        atSim: this.clock.toIso(i.atSim),
        fired: i.firedAt !== null,
        proposedBy: i.proposedBy,
      })),
    };
  }
}

function stateOf(run: RunView): DirectorState {
  const state = asRecord(asRecord(run.kpis).director);
  return {
    calls: typeof state.calls === 'number' ? state.calls : 0,
    lastTurnAt: typeof state.lastTurnAt === 'string' ? state.lastTurnAt : null,
  };
}
