import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  JobContextRunner,
  type ContextualJobData,
} from '../core/context/job-context';
import { EngineRunner, type EngineRunJob } from '../modules/planning';
import { QUEUES } from '../queues';

/**
 * Finishes an Auto-suggest run (AC-PLN-09): the engine and the writes run in
 * one transaction; when that fails it rolls back, and the run is marked
 * FAILED in a transaction of its own (AC-PLN-11). Not retried: a dispatcher
 * starts a new run.
 */
@Processor(QUEUES.allocation)
export class AllocationProcessor extends WorkerHost {
  constructor(
    private readonly runner: EngineRunner,
    private readonly jobs: JobContextRunner,
  ) {
    super();
  }

  async process(
    job: Job<EngineRunJob & ContextualJobData>,
  ): Promise<{ status: string }> {
    try {
      const run = await this.jobs.runInJobContext(job, () =>
        this.runner.complete(job.data),
      );
      return { status: run.status };
    } catch (err) {
      await this.jobs.runInJobContext(job, () =>
        this.runner.fail(job.data.runId, err),
      );
      return { status: 'FAILED' };
    }
  }
}
