import {
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ClockService } from '../core/clock/clock.service';
import { SimulationRunner } from '../modules/simulation';

/** How often a run moves: once a real second, a simulated minute at 60x. */
const STEP_MS = 1_000;
/** The most real time one step may stand for, so a stalled worker never jumps the day. */
const MAX_STEP_MS = 5_000;

/**
 * Plays the simulation runs. The one-minute ticker is too coarse for a day
 * that passes at 60x, so this is the worker's own one-second loop; it reads
 * the wall clock only to measure how long the last step took. A second
 * worker replica would double the speed: run one worker while simulating.
 */
@Injectable()
export class SimulationLoop implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private last = 0;

  constructor(
    private readonly runner: SimulationRunner,
    private readonly clock: ClockService,
  ) {}

  onApplicationBootstrap(): void {
    this.last = this.clock.realNow().getTime();
    this.timer = setInterval(() => void this.step(), STEP_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async step(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = this.clock.realNow().getTime();
      const elapsed = Math.min(now - this.last, MAX_STEP_MS);
      this.last = now;
      for (const runId of await this.runner.active())
        await this.runner.safeTick(runId, elapsed);
    } catch {
      // active() failed (the database is away): the next step tries again.
    } finally {
      this.busy = false;
    }
  }
}
