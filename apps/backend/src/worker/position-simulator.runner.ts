import {
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { JobContextRunner } from '../core/context/job-context';
import { PositionSimulator } from '../modules/execution';

/** How often simulated vehicles report: the screens' own throttle. */
const EVERY_MS = 5_000;

/**
 * Demo only (DEMO_MODE=true and SIMULATE_POSITIONS not false): moves the
 * running trips on 19's map every 5 seconds. In the worker, never the API, so
 * more API replicas never multiply it; a second worker only repeats fixes the
 * ping pipeline dedupes. A step still running when the next is due is skipped.
 */
@Injectable()
export class PositionSimulatorRunner
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private readonly config: ConfigService,
    private readonly simulator: PositionSimulator,
    private readonly jobs: JobContextRunner,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(PositionSimulatorRunner.name);
  }

  onApplicationBootstrap(): void {
    const on =
      this.config.get<boolean>('DEMO_MODE') === true &&
      this.config.get<boolean>('SIMULATE_POSITIONS') !== false;
    if (!on) return;
    this.log.info(
      { event: 'tracking.simulator.started', everyMs: EVERY_MS },
      'position simulator on',
    );
    this.timer = setInterval(() => void this.tick(), EVERY_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.jobs.run(
        { id: `simulator:positions:${Date.now()}` },
        () => this.simulator.step(),
        { transaction: false },
      );
    } catch (err: unknown) {
      this.log.warn(
        { event: 'tracking.simulator.failed', err },
        'position simulator step failed',
      );
    } finally {
      this.busy = false;
    }
  }
}
