import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, desc, eq, gt, gte, isNotNull } from 'drizzle-orm';
import Redis from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { Observable, Subject } from 'rxjs';
import { ClockService } from '../../core/clock/clock.service';
import {
  EVENTS_CHANNEL,
  type DeliveredEvent,
} from '../../core/outbox/event-bus';
import { toDelivered } from '../../core/outbox/outbox-relay.service';
import type { Database } from '../../db/client';
import { DB } from '../../db/database.module';
import { outboxEvents } from '../../db/schema';

/** How far back a reconnect can catch up before it is told to resync (AC-RT-06). */
export const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** More missed events than this and a full refetch is cheaper than the replay. */
const REPLAY_LIMIT = 2_000;

export type Replay =
  { resync: true } | { resync: false; events: DeliveredEvent[] };

/**
 * Fan-out for the SSE streams on one API instance. The relay publishes every
 * event on one Redis channel; the hub holds a single subscriber to it while at
 * least one stream is open, and drops it when the last one closes (AC-RT-10).
 * Each stream filters the shared feed by its own channels.
 *
 * A reconnect replays from outbox_events rather than a Redis Stream: the
 * outbox already keeps every published event under the id the frame carries,
 * so the replay is exact and there is no second copy to trim.
 */
@Injectable()
export class RealtimeHub implements OnModuleDestroy {
  private readonly feed = new Subject<DeliveredEvent>();
  private subscriber?: Redis;
  private pending?: Promise<unknown>;
  private open = 0;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly clock: ClockService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(RealtimeHub.name);
  }

  /** Streams open on this instance (the sse_connections gauge). */
  get connections(): number {
    return this.open;
  }

  /** Whether this instance holds the Redis subscription right now. */
  get subscribed(): boolean {
    return this.subscriber !== undefined;
  }

  /**
   * Every relayed event, for as long as the caller stays subscribed. The
   * first subscriber opens the Redis subscription and the last one to leave
   * closes it.
   */
  live(): Observable<DeliveredEvent> {
    return new Observable<DeliveredEvent>((sub) => {
      this.acquire();
      const inner = this.feed.subscribe(sub);
      return () => {
        inner.unsubscribe();
        this.release();
      };
    });
  }

  /** Resolves once Redis confirmed the subscription, so a replay read after it misses nothing. */
  async ready(): Promise<void> {
    await this.pending;
  }

  /** The newest published event: where a fresh stream starts counting from. */
  async latestId(): Promise<string | undefined> {
    const [row] = await this.db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(isNotNull(outboxEvents.publishedAt))
      .orderBy(desc(outboxEvents.id))
      .limit(1);
    return row?.id;
  }

  /** What was published after `lastEventId`, or a resync when that id is unknown or too old. */
  async replay(lastEventId: string): Promise<Replay> {
    const since = new Date(this.clock.realNow().getTime() - REPLAY_WINDOW_MS);
    const [last] = await this.db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.id, lastEventId),
          isNotNull(outboxEvents.publishedAt),
          gte(outboxEvents.publishedAt, since),
        ),
      );
    if (!last) return { resync: true };

    const rows = await this.db
      .select()
      .from(outboxEvents)
      .where(
        and(
          gt(outboxEvents.id, lastEventId),
          isNotNull(outboxEvents.publishedAt),
        ),
      )
      .orderBy(asc(outboxEvents.id))
      .limit(REPLAY_LIMIT + 1);
    if (rows.length > REPLAY_LIMIT) return { resync: true };
    return { resync: false, events: rows.map(toDelivered) };
  }

  onModuleDestroy(): void {
    this.subscriber?.disconnect();
    this.subscriber = undefined;
  }

  private acquire(): void {
    this.open += 1;
    if (this.subscriber) return;
    const redis = new Redis(this.config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: 1,
    });
    redis.on('message', (_channel: string, message: string) => {
      try {
        const parsed: unknown = JSON.parse(message);
        if (isDelivered(parsed)) this.feed.next(parsed);
      } catch (err: unknown) {
        this.log.warn(
          { event: 'realtime.event.unreadable', err },
          'dropped an event that was not JSON',
        );
      }
    });
    this.subscriber = redis;
    this.pending = redis.subscribe(EVENTS_CHANNEL);
  }

  private release(): void {
    this.open = Math.max(0, this.open - 1);
    if (this.open > 0 || !this.subscriber) return;
    this.subscriber.disconnect();
    this.subscriber = undefined;
    this.pending = undefined;
  }
}

/** The relay's JSON: enough to route and frame; anything else is dropped. */
const isDelivered = (value: unknown): value is DeliveredEvent =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as DeliveredEvent).id === 'string' &&
  typeof (value as DeliveredEvent).type === 'string' &&
  Array.isArray((value as DeliveredEvent).outletIds) &&
  Array.isArray((value as DeliveredEvent).userIds);
