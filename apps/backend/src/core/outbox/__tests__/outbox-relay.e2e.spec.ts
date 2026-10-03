import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq, inArray } from 'drizzle-orm';
import Redis from 'ioredis';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import { suffix } from '../../../../test/fixtures';
import type { Database } from '../../../db/client';
import { outboxEvents } from '../../../db/schema';
import { JobContextRunner } from '../../context/job-context';
import { EVENTS_CHANNEL, EventBus, type DeliveredEvent } from '../event-bus';
import { MAX_ATTEMPTS, OutboxRelay } from '../outbox-relay.service';
import { OutboxService } from '../outbox.service';

const itWithRedis = process.env.TEST_REDIS_URL ? it : it.skip;

/**
 * The relay (ROO-24): every committed outbox row reaches its consumers once,
 * a rolled-back one never does, and a consumer that fails is retried. Each
 * test relays only its own event types, because other suites share the
 * database and leave rows of their own.
 */
describeWithDb('outbox relay', () => {
  jest.setTimeout(60_000);

  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  const sfx = suffix();
  /** What the test consumers saw, by type. */
  const seen = new Map<string, DeliveredEvent[]>();
  /** Types whose consumer throws, until removed from the set. */
  const failing = new Set<string>();

  const typeOf = (name: string) => `test.relay.${name}.${sfx}`;
  const add = (type: string, routing: { userIds?: string[] } = {}) =>
    app
      .get(JobContextRunner)
      .run({ id: `test:add:${suffix()}` }, () =>
        app
          .get(OutboxService)
          .add(
            type,
            { v: 1, n: 1 },
            { aggregate: ['test', sfx], depotId: 'PLG', ...routing },
          ),
      );
  const drain = (...types: string[]) => app.get(OutboxRelay).drain({ types });
  const rowsOf = (type: string) =>
    db.select().from(outboxEvents).where(eq(outboxEvents.type, type));

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    app.get(EventBus).register({
      name: `test-${sfx}`,
      consumes: (type) => type.endsWith(sfx),
      handle: (event) => {
        if (failing.has(event.type)) throw new Error('consumer is down');
        seen.set(event.type, [...(seen.get(event.type) ?? []), event]);
        return Promise.resolve();
      },
    });
  });

  afterAll(async () => {
    // Leave no unpublished test rows for a real relay to chew on.
    await db
      .update(outboxEvents)
      .set({ publishedAt: new Date() })
      .where(
        inArray(
          outboxEvents.type,
          [
            'rolled-back',
            'once',
            'bad',
            'good',
            'poison',
            'race',
            'users',
            'redis',
          ].map(typeOf),
        ),
      );
    await close();
    await app.close();
  });

  it('never publishes an event whose transaction rolled back', async () => {
    const type = typeOf('rolled-back');
    await expect(
      app
        .get(JobContextRunner)
        .run({ id: `test:rollback:${sfx}` }, async () => {
          await app
            .get(OutboxService)
            .add(type, { v: 1 }, { aggregate: ['test', sfx] });
          throw new Error('the use case failed');
        }),
    ).rejects.toThrow('the use case failed');

    expect(await drain(type)).toEqual({ published: 0, failed: 0 });
    expect(await rowsOf(type)).toHaveLength(0);
    expect(seen.get(type)).toBeUndefined();
  });

  it('delivers a committed event once and marks it published', async () => {
    const type = typeOf('once');
    const { id } = await add(type);

    expect(await drain(type)).toEqual({ published: 1, failed: 0 });
    expect(seen.get(type)).toEqual([
      expect.objectContaining({
        id,
        type,
        depotId: 'PLG',
        payload: { v: 1, n: 1 },
      }),
    ]);
    const [row] = await rowsOf(type);
    expect(row.publishedAt).not.toBeNull();

    // A restarted relay finds nothing left to do.
    expect(await drain(type)).toEqual({ published: 0, failed: 0 });
    expect(seen.get(type)).toHaveLength(1);
  });

  it('retries a failing consumer without holding up the other events', async () => {
    const bad = typeOf('bad');
    const good = typeOf('good');
    failing.add(bad);
    await add(bad);
    await add(good);

    expect(await drain(bad, good)).toEqual({ published: 1, failed: 1 });
    const [row] = await rowsOf(bad);
    expect(row).toMatchObject({
      publishedAt: null,
      attempts: 1,
      lastError: 'consumer is down',
    });
    expect(seen.get(good)).toHaveLength(1);

    failing.delete(bad);
    expect(await drain(bad, good)).toEqual({ published: 1, failed: 0 });
    expect(seen.get(bad)).toHaveLength(1);
  });

  it('sets an event aside after the last attempt', async () => {
    const type = typeOf('poison');
    failing.add(type);
    await add(type);
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) await drain(type);

    const [row] = await rowsOf(type);
    expect(row).toMatchObject({ publishedAt: null, attempts: MAX_ATTEMPTS });
    // No more tries: the row waits for a person, not for the next tick.
    expect(await drain(type)).toEqual({ published: 0, failed: 0 });
  });

  it('hands each event to one relay when two run at once', async () => {
    const type = typeOf('race');
    for (let i = 0; i < 6; i += 1) await add(type);

    const [a, b] = await Promise.all([drain(type), drain(type)]);
    expect(a.published + b.published).toBe(6);
    expect(seen.get(type)).toHaveLength(6);
    expect(new Set(seen.get(type)!.map((e) => e.id)).size).toBe(6);
  });

  it('keeps the users an event is routed to', async () => {
    const type = typeOf('users');
    await add(type, { userIds: ['user-1', 'user-2'] });
    const [row] = await rowsOf(type);
    expect(row.userIds).toEqual(['user-1', 'user-2']);
    await drain(type);
    expect(seen.get(type)?.[0].userIds).toEqual(['user-1', 'user-2']);
  });

  itWithRedis(
    'publishes to Redis after the commit, for the SSE gateway',
    async () => {
      const type = typeOf('redis');
      const sub = new Redis(process.env.TEST_REDIS_URL!);
      try {
        const received = new Promise<DeliveredEvent>((resolve) => {
          sub.on('message', (_channel, message) => {
            const event = JSON.parse(message) as DeliveredEvent;
            if (event.type === type) resolve(event);
          });
        });
        await sub.subscribe(EVENTS_CHANNEL);
        const { id } = await add(type);
        await drain(type);
        await expect(received).resolves.toMatchObject({
          id,
          type,
          depotId: 'PLG',
        });
      } finally {
        sub.disconnect();
      }
    },
  );

  it('wires alerts and loading to the events they consume', () => {
    const names = (type: string) =>
      app
        .get(EventBus)
        .consumersOf(type)
        .map((c) => c.name);
    expect(names('plan.published')).toContain('loading');
    expect(names('trip.cant_run')).toContain('alerts');
    expect(names('test.nobody.listens')).toEqual([]);
  });
});
