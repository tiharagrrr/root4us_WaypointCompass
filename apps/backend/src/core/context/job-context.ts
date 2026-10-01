import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import type { Job } from 'bullmq';
import { CLS_ID, ClsService } from 'nestjs-cls';
import { PinoLogger } from 'nestjs-pino';
import { SYSTEM_ACTOR } from '../../db/actor';
import type { StampedDrizzleAdapter } from '../persistence/transactions';
import type { AppClsStore } from './request-context';

/** Who asked for the work and which request it belongs to; carried on job data as `_ctx`. */
export interface JobContext {
  correlationId?: string;
  /** The person who asked for it, for audit rows; the database sees the system. */
  actor?: Actor;
}

export interface ContextualJobData {
  _ctx?: JobContext;
}

export interface RunOptions {
  /** Run `work` in one stamped transaction (default), or let each service open its own. */
  transaction?: boolean;
}

/**
 * The context to put on a job so the worker can restore it:
 * `queue.add('run', { ...data, _ctx: jobContextOf(this.cls) })`.
 */
export function jobContextOf(cls: ClsService<AppClsStore>): JobContext {
  if (!cls.isActive()) return {};
  return { correlationId: cls.get('correlationId'), actor: cls.get('actor') };
}

/**
 * Restores a job's context in the worker: a CLS context with the job's
 * correlation id and requester, log lines tagged with the queue, job id and
 * attempt, and (by default) one transaction stamped as the system for
 * row-level security, which the command services' @Transactional() join.
 *
 *   process(job: Job<AllocationJob>) {
 *     return this.jobs.runInJobContext(job, () => this.engine.run(job.data));
 *   }
 */
@Injectable()
export class JobContextRunner {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly log: PinoLogger,
  ) {}

  runInJobContext<T>(
    job: Job<ContextualJobData>,
    work: () => Promise<T>,
    options?: RunOptions,
  ): Promise<T> {
    const context = job.data?._ctx ?? {};
    return this.run(
      {
        ...context,
        id: `job:${job.queueName}:${job.id}`,
        bindings: {
          queue: job.queueName,
          jobId: job.id,
          attempt: job.attemptsMade + 1,
        },
      },
      work,
      options,
    );
  }

  /** The same for work that is not a BullMQ job, such as one ticker handler. */
  run<T>(
    context: JobContext & { id: string; bindings?: Record<string, unknown> },
    work: () => Promise<T>,
    { transaction = true }: RunOptions = {},
  ): Promise<T> {
    const correlationId = context.correlationId ?? context.id;
    return this.cls.run({ ifNested: 'override' }, () => {
      this.cls.set(CLS_ID, context.id);
      this.cls.set('correlationId', correlationId);
      this.cls.set('deviceId', null);
      this.cls.set('dbActor', SYSTEM_ACTOR);
      if (context.actor) this.cls.set('actor', context.actor);
      const bindings = {
        ...context.bindings,
        correlationId,
        ...(context.actor && {
          actor: { id: context.actor.id, role: context.actor.role },
        }),
      };
      return this.log.runInContext(
        () => (transaction ? this.txHost.withTransaction(work) : work()),
        { bindings },
      );
    });
  }
}
