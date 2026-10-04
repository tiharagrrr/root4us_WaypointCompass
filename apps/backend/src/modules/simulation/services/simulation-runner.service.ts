import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { JobContextRunner } from '../../../core/context/job-context';
import { SimulationGate } from '../policies/simulation.gate';
import { SIMULATION_LOGS } from '../simulation.constants';
import { SimulationDirector } from './simulation-director.service';
import { SimulationQueries } from './simulation.queries';
import { SimulationService } from './simulation.service';
import { VirtualDrivers } from './virtual-drivers.service';

/**
 * What the worker's loop does for a run once a second, and what a test calls
 * to move simulated time by hand: move the clock on and fire the trouble that
 * is due, let the virtual drivers catch up, refresh the numbers, then give
 * the director its turn. A stopped agentic run gets its report here, because
 * a model is never called during a request. Each part is its own
 * transaction; no model call holds one open.
 */
@Injectable()
export class SimulationRunner {
  constructor(
    private readonly gate: SimulationGate,
    private readonly jobs: JobContextRunner,
    private readonly queries: SimulationQueries,
    private readonly runs: SimulationService,
    private readonly drivers: VirtualDrivers,
    private readonly director: SimulationDirector,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(SimulationRunner.name);
  }

  /** The runs with work to do. */
  active(): Promise<string[]> {
    if (!this.gate.enabled) return Promise.resolve([]);
    return this.inContext('active', () => this.queries.active(), true);
  }

  async tick(runId: string, realElapsedMs: number): Promise<void> {
    if (!this.gate.enabled) return;
    const run = await this.inContext(runId, () =>
      this.runs.advance(runId, realElapsedMs),
    );
    if (run) {
      await this.drivers.drive(run);
      await this.inContext(runId, () => this.runs.refreshKpis(runId));
      await this.inContext(runId, () => this.director.turn(runId));
    }
    await this.inContext(runId, () => this.director.narrate(runId));
  }

  /** A tick that logs its failure instead of throwing, for the loop. */
  async safeTick(runId: string, realElapsedMs: number): Promise<void> {
    try {
      await this.tick(runId, realElapsedMs);
    } catch (error: unknown) {
      this.log.error(
        { event: SIMULATION_LOGS.tickFailed, runId, err: error },
        'simulation tick failed',
      );
    }
  }

  private inContext<T>(
    id: string,
    work: () => Promise<T>,
    transaction = false,
  ): Promise<T> {
    return this.jobs.run({ id: `simulation:${id}` }, work, { transaction });
  }
}
