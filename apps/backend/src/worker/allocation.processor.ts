import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUES } from '../queues';

export interface AllocationJob {
  planDate: string;
  depotId: string;
  requestedBy: string;
}

@Processor(QUEUES.allocation)
export class AllocationProcessor extends WorkerHost {
  private readonly logger = new Logger(AllocationProcessor.name);

  process(job: Job<AllocationJob>): Promise<{ status: string }> {
    // TODO(engine): run the allocation engine (group by brand + district,
    // priority score, first-fit decreasing, validate with @waypoint/shared)
    // and persist trips, stops and deferrals with audit events.
    this.logger.log(
      `allocation requested for ${job.data.depotId} on ${job.data.planDate}`,
    );
    return Promise.resolve({ status: 'not_implemented' });
  }
}
