import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  OutboxRelay,
  type DrainResult,
} from '../core/outbox/outbox-relay.service';
import { QUEUES } from '../queues';

/**
 * Drains the outbox every second (ROO-24): a BullMQ job scheduler rather than
 * setInterval, so more worker replicas never multiply it, and the relay's
 * SKIP LOCKED keeps two overlapping drains from taking the same row.
 */
@Processor(QUEUES.outbox)
export class OutboxProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  constructor(
    private readonly relay: OutboxRelay,
    @InjectQueue(QUEUES.outbox) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'outbox-relay',
      { every: 1_000 },
      { name: 'drain', opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  process(): Promise<DrainResult> {
    return this.relay.drain();
  }
}
