import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lt,
  notInArray,
  sql,
} from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { uuidv7 } from 'uuidv7';
import { outboxEvents } from '../../db/schema';
import { ClockService } from '../clock/clock.service';
import { JobContextRunner } from '../context/job-context';
import type { StampedDrizzleAdapter } from '../persistence/transactions';
import { EventBus, type DeliveredEvent } from './event-bus';
import { EventPublisher } from './event-publisher';

/** After this many failed deliveries a row is set aside for a person to look at. */
export const MAX_ATTEMPTS = 10;
/** Rows one drain relays at most, so a backlog cannot hold one job forever. */
const BATCH = 200;

export interface DrainResult {
  published: number;
  failed: number;
}

type OutboxRow = typeof outboxEvents.$inferSelect;

/**
 * Delivers committed outbox rows to the consumers in this process, then
 * publishes them on Redis (ROO-24). The worker runs `drain()` every second.
 *
 * One row at a time, each in its own transaction: the row is claimed with
 * `FOR UPDATE SKIP LOCKED`, so two relays never take the same row; every
 * consumer's `handle` joins that transaction, so its writes and the row's
 * `publishedAt` commit together or not at all. A row only exists once its
 * use case committed, so a rolled-back change is never relayed.
 *
 * A consumer that throws rolls the row's transaction back; the row records the
 * attempt and the error and is tried again on the next drain, while the rows
 * behind it carry on. After MAX_ATTEMPTS it is set aside and logged.
 * Delivery is at least once, so consumers dedupe on the event id (alerts and
 * loading keep receipts tables for that).
 */
@Injectable()
export class OutboxRelay {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly jobs: JobContextRunner,
    private readonly bus: EventBus,
    private readonly publisher: EventPublisher,
    private readonly clock: ClockService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(OutboxRelay.name);
  }

  /** Relays what is waiting; `types` limits it to those event types. */
  async drain({ types }: { types?: string[] } = {}): Promise<DrainResult> {
    const result: DrainResult = { published: 0, failed: 0 };
    const failedIds: string[] = [];
    for (let i = 0; i < BATCH; i += 1) {
      const outcome = await this.relayNext(failedIds, types);
      if (outcome === 'empty') break;
      result[outcome] += 1;
    }
    return result;
  }

  private async relayNext(
    skip: string[],
    types?: string[],
  ): Promise<'published' | 'failed' | 'empty'> {
    // Filled inside the transaction's callback; an object, so the compiler
    // does not narrow it to its initial value across the await.
    const got: { row?: OutboxRow; event?: DeliveredEvent } = {};
    try {
      await this.jobs.run({ id: `outbox:relay:${uuidv7()}` }, async () => {
        const [claimed] = await this.txHost.tx
          .select()
          .from(outboxEvents)
          .where(
            and(
              isNull(outboxEvents.publishedAt),
              lt(outboxEvents.attempts, MAX_ATTEMPTS),
              skip.length ? notInArray(outboxEvents.id, skip) : undefined,
              types ? inArray(outboxEvents.type, types) : undefined,
            ),
          )
          .orderBy(asc(outboxEvents.occurredAt), asc(outboxEvents.id))
          .limit(1)
          .for('update', { skipLocked: true });
        if (!claimed) return;
        got.row = claimed;

        const event = (got.event = toDelivered(claimed));
        for (const consumer of this.bus.consumersOf(claimed.type))
          await consumer.handle(event);
        await this.txHost.tx
          .update(outboxEvents)
          .set({ publishedAt: this.clock.realNow() })
          .where(eq(outboxEvents.id, claimed.id));
      });
    } catch (err) {
      if (!got.row) throw err;
      skip.push(got.row.id);
      await this.recordFailure(got.row, err);
      return 'failed';
    }
    const { event } = got;
    if (!event) return 'empty';

    // After the commit: a screen must never see an event that did not happen.
    // Losing this message costs a live update, not the event; the SSE gateway
    // replays from the outbox by Last-Event-ID.
    await this.publisher
      .publish(event)
      .catch((err: unknown) =>
        this.log.warn(
          { event: 'outbox.publish_failed', eventId: event.id, err },
          'could not publish an event to Redis',
        ),
      );
    return 'published';
  }

  private async recordFailure(row: OutboxRow, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const attempts = row.attempts + 1;
    await this.jobs.run({ id: `outbox:failed:${row.id}` }, () =>
      this.txHost.tx
        .update(outboxEvents)
        .set({
          attempts: sql`${outboxEvents.attempts} + 1`,
          lastError: message.slice(0, 1_000),
        })
        .where(eq(outboxEvents.id, row.id)),
    );
    const fields = { eventId: row.id, type: row.type, attempts };
    if (attempts >= MAX_ATTEMPTS)
      this.log.error(
        { event: 'outbox.event_set_aside', ...fields, err },
        'event set aside after its last delivery attempt',
      );
    else
      this.log.warn(
        { event: 'outbox.delivery_failed', ...fields, err },
        'event delivery failed; it will be retried',
      );
  }
}

function toDelivered(row: OutboxRow): DeliveredEvent {
  return {
    id: row.id,
    type: row.type,
    depotId: row.depotId,
    outletIds: row.outletIds,
    userIds: row.userIds,
    payload: row.payload,
    occurredAt: row.occurredAt,
    correlationId: row.correlationId,
  };
}
