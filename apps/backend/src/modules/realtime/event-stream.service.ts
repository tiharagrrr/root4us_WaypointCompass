import { Injectable, type MessageEvent } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import { PinoLogger } from 'nestjs-pino';
import { Gauge, register } from 'prom-client';
import { Observable } from 'rxjs';
import type { DeliveredEvent } from '../../core/outbox/event-bus';
import { MyTripsQueries } from '../execution';
import { channelsFor, reaches, toDomainEvent } from './domain/channels';
import { RealtimeHub } from './realtime.hub';

/** The browser waits this long before it reconnects. */
export const RETRY_MS = 3_000;
/** A frame at least this often, so proxies keep an idle stream open (AC-RT-09). */
export const HEARTBEAT_MS = 15_000;
/** A plan change can hand a driver a new trip, so her trip channels are read again. */
const DRIVER_REFRESH = new Set([
  'plan.published',
  'plan.revised',
  'trip.reassigned',
  'trip.released',
]);
/** Revoke the user's sessions; the stream ends so its reconnect is refused (401). */
const ACCESS_ENDED = new Set([
  'identity.user.role_changed',
  'identity.user.scope_changed',
  'identity.user.deactivated',
]);
/** Open streams by role, scraped from /metrics (spec: sse_connections). */
const CONNECTIONS_METRIC = 'waypoint_sse_connections';
const connections =
  (register.getSingleMetric(CONNECTIONS_METRIC) as Gauge<'role'> | undefined) ??
  new Gauge({
    name: CONNECTIONS_METRIC,
    help: 'Open SSE streams on this instance',
    labelNames: ['role'],
  });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One client's GET /streams/me: its channels from the actor, the events it
 * missed since Last-Event-ID, then the live feed, with a heartbeat between.
 * Live events that arrive while the replay is read are held and sent after
 * it, and an id is never sent twice.
 */
@Injectable()
export class EventStreamService {
  constructor(
    private readonly hub: RealtimeHub,
    private readonly myTrips: MyTripsQueries,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(EventStreamService.name);
  }

  stream(actor: Actor, lastEventId?: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((out) => {
      const sent = new Set<string>();
      // Nest numbers a frame with no id, and the browser would send that number
      // back as Last-Event-ID. Control frames carry the stream's cursor instead:
      // the last event sent, or the newest one when the stream opened.
      let cursor = lastEventId;
      const control = (type: string) =>
        out.next({ id: cursor, type, data: {}, retry: RETRY_MS });
      let channels = channelsFor(actor);
      let tripIds: string[] = [];
      // Every step runs in turn, so a driver's refresh never reorders frames.
      let queue: Promise<void> = Promise.resolve();
      const then = (step: () => Promise<void> | void) => {
        queue = queue.then(step).catch((err: unknown) => out.error(err));
      };

      const refreshTrips = async () => {
        if (actor.role !== 'driver') return false;
        const next = (await this.myTrips.list(actor)).map((t) => t.id).sort();
        const changed = next.join() !== tripIds.join();
        tripIds = next;
        channels = channelsFor(actor, tripIds);
        return changed;
      };
      const send = (event: DeliveredEvent) => {
        if (sent.has(event.id)) return;
        sent.add(event.id);
        cursor = event.id;
        out.next({
          id: event.id,
          type: event.type,
          data: toDomainEvent(event),
          retry: RETRY_MS,
        });
      };
      const onEvent = async (event: DeliveredEvent) => {
        const gained = DRIVER_REFRESH.has(event.type) && (await refreshTrips());
        if (gained || reaches(channels, event)) send(event);
        if (
          ACCESS_ENDED.has(event.type) &&
          event.aggregateType === 'user' &&
          event.aggregateId === actor.id
        )
          return out.complete();
        // Past it either way, so a reconnect does not re-read other channels' traffic.
        cursor = event.id;
      };

      // Subscribe before reading the replay, so nothing falls between them.
      const live = this.hub.live().subscribe({
        next: (event) => then(() => onEvent(event)),
        error: (err: unknown) => out.error(err),
      });
      then(async () => {
        await this.hub.ready();
        await refreshTrips();
        const replay = !lastEventId
          ? undefined
          : UUID.test(lastEventId)
            ? await this.hub.replay(lastEventId)
            : ({ resync: true } as const);
        if (!replay || replay.resync) cursor = await this.hub.latestId();
        // The first frame tells the browser how long to wait before reconnecting.
        control('ready');
        if (!replay) return;
        if (replay.resync) return control('resync');
        for (const event of replay.events) {
          if (reaches(channels, event)) send(event);
          cursor = event.id;
        }
      });
      const beat = setInterval(() => control('heartbeat'), HEARTBEAT_MS);

      connections.inc({ role: actor.role });
      this.log.info(
        { event: 'realtime.stream.opened', role: actor.role },
        'stream opened',
      );
      return () => {
        clearInterval(beat);
        live.unsubscribe();
        connections.dec({ role: actor.role });
        this.log.info(
          { event: 'realtime.stream.closed', role: actor.role },
          'stream closed',
        );
      };
    });
  }
}
