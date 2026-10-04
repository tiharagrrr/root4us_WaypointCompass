import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import {
  plans,
  simulationInjections,
  simulationRuns,
  stops,
  trips,
} from '../../../db/schema';
import { SimulationScope } from '../policies/simulation.scope';

export type RunRow = typeof simulationRuns.$inferSelect;
export type InjectionRow = typeof simulationInjections.$inferSelect;

/** A run with its plan's depot and date, and its trouble in firing order. */
export interface RunView extends RunRow {
  depotId: string | null;
  planDate: string | null;
  injections: InjectionRow[];
}

export interface RunKpis {
  stopsDelivered: number;
  stopsFailed: number;
  tripsCompleted: number;
  injections: number;
}

const LIST_LIMIT = 20;

@Injectable()
export class SimulationQueries {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: SimulationScope,
  ) {}

  /** One run in the actor's scope, or 404. */
  async get(id: string, actor: Actor): Promise<RunView> {
    const [row] = await this.select(
      and(eq(simulationRuns.id, id), this.scope.where(actor)),
    );
    return this.scope.found(row);
  }

  /** The newest runs in the actor's scope. */
  list(actor: Actor): Promise<RunView[]> {
    return this.select(this.scope.where(actor));
  }

  /**
   * A run for the worker's loop, which acts as the system and has no actor to
   * scope by; null when the run is gone.
   */
  async load(id: string): Promise<RunView | null> {
    const [row] = await this.select(eq(simulationRuns.id, id));
    return row ?? null;
  }

  /** The runs the loop has work for: playing, or stopped and waiting for the director's report. */
  async active(): Promise<string[]> {
    const rows = await this.txHost.tx
      .select({ id: simulationRuns.id })
      .from(simulationRuns)
      .where(
        sql`${simulationRuns.status} = 'RUNNING' OR (${simulationRuns.status} = 'COMPLETED' AND ${simulationRuns.agentic} AND ${simulationRuns.narrative} IS NULL)`,
      );
    return rows.map((row) => row.id);
  }

  /** Another run holding the demo clock, if any. */
  async holderOfClock(exceptId: string): Promise<string | null> {
    const [row] = await this.txHost.tx
      .select({ id: simulationRuns.id })
      .from(simulationRuns)
      .where(
        and(
          inArray(simulationRuns.status, ['RUNNING', 'PAUSED']),
          sql`${simulationRuns.id} <> ${exceptId}`,
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }

  /** What the plan's trips have done so far. */
  async kpis(run: RunRow): Promise<RunKpis> {
    if (!run.planId)
      return {
        stopsDelivered: 0,
        stopsFailed: 0,
        tripsCompleted: 0,
        injections: 0,
      };
    const count = (condition: ReturnType<typeof sql>) =>
      sql<number>`count(*) FILTER (WHERE ${condition})`.mapWith(Number);
    const [stopCounts] = await this.txHost.tx
      .select({
        delivered: count(sql`${stops.status} IN ('DELIVERED', 'PARTIAL')`),
        failed: count(sql`${stops.status} = 'FAILED'`),
      })
      .from(stops)
      .innerJoin(trips, eq(trips.id, stops.tripId))
      .where(eq(trips.planId, run.planId));
    const tripsCompleted = await this.txHost.tx.$count(
      trips,
      and(eq(trips.planId, run.planId), eq(trips.status, 'COMPLETED')),
    );
    const injections = await this.txHost.tx.$count(
      simulationInjections,
      and(
        eq(simulationInjections.runId, run.id),
        isNotNull(simulationInjections.firedAt),
      ),
    );
    return {
      stopsDelivered: stopCounts?.delivered ?? 0,
      stopsFailed: stopCounts?.failed ?? 0,
      tripsCompleted,
      injections,
    };
  }

  private async select(where: ReturnType<typeof and>): Promise<RunView[]> {
    const rows = await this.txHost.tx
      .select({
        run: simulationRuns,
        depotId: plans.depotId,
        planDate: plans.date,
      })
      .from(simulationRuns)
      .innerJoin(plans, eq(plans.id, simulationRuns.planId))
      .where(where)
      .orderBy(desc(simulationRuns.createdAt))
      .limit(LIST_LIMIT);
    if (!rows.length) return [];
    const injections = await this.txHost.tx
      .select()
      .from(simulationInjections)
      .where(
        inArray(
          simulationInjections.runId,
          rows.map((row) => row.run.id),
        ),
      )
      .orderBy(asc(simulationInjections.atSim), asc(simulationInjections.id));
    return rows.map((row) => ({
      ...row.run,
      depotId: row.depotId,
      planDate: row.planDate,
      injections: injections.filter((i) => i.runId === row.run.id),
    }));
  }
}
