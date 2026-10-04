import type { NestExpressApplication } from '@nestjs/platform-express';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { signedInAs } from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import { depotFixture, outletFixture, suffix } from '../../../../test/fixtures';
import { expectProblem } from '../../../../test/kernel';
import { JobContextRunner } from '../../../core/context/job-context';
import { OutboxRelay } from '../../../core/outbox/outbox-relay.service';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { Database } from '../../../db/client';
import { outboxEvents } from '../../../db/schema';
import { RealtimeHub } from '../realtime.hub';

interface Frame {
  id?: string;
  event?: string;
  retry?: number;
  data?: unknown;
}

/** An EventSource stand-in: reads GET /streams/me and parses frames as they come. */
function open(base: string, cookie: string, lastEventId?: string) {
  const frames: Frame[] = [];
  const abort = new AbortController();
  const done = (async () => {
    const res = await fetch(`${base}/api/v1/streams/me`, {
      headers: {
        cookie,
        accept: 'text/event-stream',
        ...(lastEventId && { 'last-event-id': lastEventId }),
      },
      signal: abort.signal,
    });
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) return;
      buffer += value;
      let cut: number;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const frame: Frame = {};
        for (const line of buffer.slice(0, cut).split('\n')) {
          const [field, ...rest] = line.split(':');
          const text = rest.join(':').trimStart();
          if (field === 'id') frame.id = text;
          if (field === 'event') frame.event = text;
          if (field === 'retry') frame.retry = Number(text);
          if (field === 'data') frame.data = JSON.parse(text);
        }
        frames.push(frame);
        buffer = buffer.slice(cut + 2);
      }
    }
  })().catch(() => undefined);
  return {
    frames,
    close: async () => {
      abort.abort();
      await done;
    },
  };
}

/** Frames that carry the stream's cursor rather than an event of their own. */
const CONTROL = ['ready', 'resync', 'heartbeat'];

async function until(check: () => boolean, ms = 5_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting for a frame');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * GET /streams/me over a real socket: the relay publishes on Redis, the hub
 * fans out, and each stream carries only what its actor's channels allow.
 * Event types carry the suite's suffix, so other suites' rows never interfere.
 */
describeWithDb('realtime streams', () => {
  jest.setTimeout(60_000);

  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  let base: string;
  const sfx = suffix();
  const types: string[] = [];
  let depots: Awaited<ReturnType<typeof depotFixture>>;

  const publish = async (
    name: string,
    routing: { depotId?: string; outletIds?: string[] },
  ) => {
    const type = `test.rt.${name}.${sfx}`;
    types.push(type);
    const { id } = await app
      .get(JobContextRunner)
      .run({ id: `test:rt:${suffix()}` }, () =>
        app
          .get(OutboxService)
          .add(
            type,
            { v: 1, name },
            { aggregate: ['plan', `p-${name}`], ...routing },
          ),
      );
    await app.get(OutboxRelay).drain({ types: [type] });
    return id;
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    const address = app.getHttpServer().address() as { port: number };
    base = `http://127.0.0.1:${address.port}`;
    ({ db, close } = ownerDatabase());
    depots = await depotFixture(db, sfx);
  });

  afterAll(async () => {
    if (types.length)
      await db.delete(outboxEvents).where(inArray(outboxEvents.type, types));
    await close();
    await app.close();
  });

  it('AC-RT-12 No session, no stream', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/streams/me');
    expectProblem(res, 'UNAUTHENTICATED');
    expect(res.status).toBe(401);
  });

  it('AC-RT-04 Frames carry the outbox id and the envelope', async () => {
    const tihara = await signedInAs(app, db, {
      role: 'dispatcher',
      depotId: depots.plg,
    });
    const stream = open(base, tihara.cookie);
    await until(() => stream.frames.some((f) => f.event === 'ready'));
    expect(stream.frames[0].retry).toBe(3000);

    const kandy = await publish('kandy', { depotId: depots.kdy });
    const e = await publish('published', { depotId: depots.plg });
    await until(() => stream.frames.some((f) => f.id === e));
    await stream.close();

    const frame = stream.frames.find((f) => f.id === e);
    expect(frame).toMatchObject({
      event: `test.rt.published.${sfx}`,
      data: {
        v: 1,
        type: `test.rt.published.${sfx}`,
        aggregate: { type: 'plan', id: 'p-published' },
        routing: { depotId: depots.plg, outletIds: [], userIds: [] },
        data: { v: 1, name: 'published' },
      },
    });
    expect(stream.frames.some((f) => f.id === kandy)).toBe(false);
  });

  it('AC-RT-02 A store manager sees only her outlet', async () => {
    const depot = { depotId: depots.plg, districtId: depots.plgDistrict };
    const mine = await outletFixture(db, `OA${sfx}`, depot);
    const other = await outletFixture(db, `OB${sfx}`, depot);
    const nimesha = await signedInAs(app, db, {
      role: 'store_manager',
      outletId: mine,
    });
    const stream = open(base, nimesha.cookie);
    await until(() => stream.frames.some((f) => f.event === 'ready'));

    const theirs = await publish('other-outlet', {
      depotId: depots.plg,
      outletIds: [other],
    });
    const hers = await publish('her-outlet', {
      depotId: depots.plg,
      outletIds: [mine],
    });
    await until(() => stream.frames.some((f) => f.id === hers));
    await stream.close();
    const ids = stream.frames
      .filter((f) => !CONTROL.includes(f.event ?? ''))
      .map((f) => f.id);
    expect(ids).toEqual([hers]);
    expect(ids).not.toContain(theirs);
  });

  it('AC-RT-05 A reconnect replays what was missed', async () => {
    const tihara = await signedInAs(app, db, {
      role: 'dispatcher',
      depotId: depots.plg,
    });
    const e1 = await publish('e1', { depotId: depots.plg });
    const e2 = await publish('e2', { depotId: depots.plg });
    const elsewhere = await publish('e-kandy', { depotId: depots.kdy });
    const e3 = await publish('e3', { depotId: depots.plg });

    const stream = open(base, tihara.cookie, e1);
    await until(() => stream.frames.some((f) => f.id === e3));
    const live = await publish('e4', { depotId: depots.plg });
    await until(() => stream.frames.some((f) => f.id === live));
    await stream.close();

    const ours = new Set([e1, e2, elsewhere, e3, live]);
    const ids = stream.frames
      .filter((f) => !CONTROL.includes(f.event ?? ''))
      .map((f) => f.id)
      .filter((id): id is string => !!id && ours.has(id));
    expect(ids).toEqual([e2, e3, live]);
  });

  it('AC-RT-06 A too-old id gets a resync', async () => {
    const tihara = await signedInAs(app, db, {
      role: 'dispatcher',
      depotId: depots.plg,
    });
    const stream = open(base, tihara.cookie, uuidv7());
    await until(() => stream.frames.some((f) => f.event === 'resync'));
    await stream.close();
    expect(stream.frames.map((f) => f.event)).toEqual(['ready', 'resync']);
  });

  it('AC-RT-10 Fan-out subscribes only while a client needs it', async () => {
    const hub = app.get(RealtimeHub);
    await until(() => hub.connections === 0);
    expect(hub.subscribed).toBe(false);
    const tihara = await signedInAs(app, db, {
      role: 'dispatcher',
      depotId: depots.plg,
    });
    const stream = open(base, tihara.cookie);
    await until(() => stream.frames.some((f) => f.event === 'ready'));
    expect(hub.subscribed).toBe(true);
    expect(hub.connections).toBe(1);

    await stream.close();
    await until(() => hub.connections === 0);
    expect(hub.subscribed).toBe(false);
  });
});
