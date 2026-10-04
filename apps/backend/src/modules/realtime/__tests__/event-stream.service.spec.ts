import type { MessageEvent } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import type { PinoLogger } from 'nestjs-pino';
import { Observable, Subject } from 'rxjs';
import type { DeliveredEvent } from '../../../core/outbox/event-bus';
import type { MyTripsQueries } from '../../execution';
import { EventStreamService, HEARTBEAT_MS } from '../event-stream.service';
import type { PresenceService } from '../presence.service';
import type { RealtimeHub, Replay } from '../realtime.hub';

const ID = (n: number) => `0190a000-0000-7000-8000-00000000000${n}`;
const event = (n: number, depotId = 'PLG'): DeliveredEvent => ({
  id: ID(n),
  type: 'plan.published',
  aggregateType: 'plan',
  aggregateId: `p${n}`,
  depotId,
  outletIds: [],
  userIds: [],
  payload: { v: 1 },
  occurredAt: new Date('2026-10-04T01:00:00Z'),
  correlationId: null,
});

const tihara: Actor = {
  id: 'tihara',
  name: 'Tihara',
  role: 'dispatcher',
  depotId: 'PLG',
  outletId: null,
  vehicleId: null,
  deviceId: null,
};

function setup(replay: Replay = { resync: false, events: [] }) {
  const feed = new Subject<DeliveredEvent>();
  let open = 0;
  const hub = {
    live: () =>
      new Observable<DeliveredEvent>((sub) => {
        open += 1;
        const s = feed.subscribe(sub);
        return () => {
          s.unsubscribe();
          open -= 1;
        };
      }),
    ready: () => Promise.resolve(),
    latestId: () => Promise.resolve(ID(9)),
    replay: jest.fn(() => Promise.resolve(replay)),
  };
  const log = { setContext: jest.fn(), info: jest.fn() };
  const service = new EventStreamService(
    hub as unknown as RealtimeHub,
    { list: () => Promise.resolve([]) } as unknown as MyTripsQueries,
    {
      opened: () => Promise.resolve(),
      touch: () => Promise.resolve(),
      closed: () => Promise.resolve(),
    } as unknown as PresenceService,
    log as unknown as PinoLogger,
  );
  const frames: MessageEvent[] = [];
  return {
    feed,
    hub,
    frames,
    open: () => open,
    start: (lastEventId?: string) =>
      service.stream(tihara, lastEventId).subscribe((f) => frames.push(f)),
  };
}

const flush = () => new Promise((r) => setImmediate(r));
const CONTROL = ['ready', 'resync', 'heartbeat'];
const ids = (frames: MessageEvent[]) =>
  frames.filter((f) => !CONTROL.includes(String(f.type))).map((f) => f.id);

describe('one client stream', () => {
  it('AC-RT-05 A reconnect replays what was missed', async () => {
    const t = setup({ resync: false, events: [event(2), event(3)] });
    const sub = t.start(ID(1));
    // A live event during the replay is held, and the replayed copy is not sent twice.
    t.feed.next(event(3));
    t.feed.next(event(4));
    await flush();
    expect(t.hub.replay).toHaveBeenCalledWith(ID(1));
    expect(ids(t.frames)).toEqual([ID(2), ID(3), ID(4)]);
    // A control frame repeats the cursor, never a number of Nest's own.
    expect(t.frames[0]).toMatchObject({
      type: 'ready',
      id: ID(1),
      retry: 3000,
    });

    t.feed.next(event(5, 'KDY'));
    await flush();
    expect(ids(t.frames)).toEqual([ID(2), ID(3), ID(4)]);
    sub.unsubscribe();
  });

  it('AC-RT-06 A too-old id gets a resync', async () => {
    const t = setup({ resync: true });
    const sub = t.start(ID(1));
    await flush();
    sub.unsubscribe();
    expect(t.frames.map((f) => f.type)).toEqual(['ready', 'resync']);
    expect(t.frames[1].id).toBe(ID(9));

    const garbage = setup();
    const other = garbage.start('not-an-id');
    await flush();
    other.unsubscribe();
    expect(garbage.hub.replay).not.toHaveBeenCalled();
    expect(garbage.frames.map((f) => f.type)).toEqual(['ready', 'resync']);
  });

  it('AC-RT-13 A role change reaches the user at once', async () => {
    const t = setup();
    t.start();
    await flush();
    t.feed.next({
      ...event(6, 'PLG'),
      type: 'identity.user.role_changed',
      aggregateType: 'user',
      aggregateId: 'tihara',
      depotId: null,
    });
    await flush();
    expect(t.frames.at(-1)).toMatchObject({
      id: ID(6),
      type: 'identity.user.role_changed',
    });
    // Her sessions are revoked, so the stream ends and the reconnect is refused.
    expect(t.open()).toBe(0);
  });

  it('AC-RT-09 Idle streams stay alive', async () => {
    jest.useFakeTimers();
    try {
      const t = setup();
      const sub = t.start();
      await jest.advanceTimersByTimeAsync(45_000);
      expect(t.frames.filter((f) => f.type === 'heartbeat')).toHaveLength(
        45_000 / HEARTBEAT_MS,
      );
      sub.unsubscribe();
      expect(t.open()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
