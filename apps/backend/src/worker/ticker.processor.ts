import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { TickerService } from '../core/scheduling/ticker.service';
import { QUEUES } from '../queues';

/**
 * One tick a minute across all worker replicas: a BullMQ job scheduler
 * rather than setInterval, so scaling the worker never doubles a tick.
 * Failed handlers are logged by TickerService; the tick itself never
 * retries, because the next one comes a minute later.
 */
@Processor(QUEUES.ticker)
export class TickerProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  constructor(
    private readonly ticker: TickerService,
    @InjectQueue(QUEUES.ticker) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'ticker',
      { every: 60_000 },
      { name: 'tick', opts: { removeOnComplete: 60, removeOnFail: 1_000 } },
    );
  }

  async process(): Promise<{ failed: string[] }> {
    return { failed: await this.ticker.tick() };
  }
}
