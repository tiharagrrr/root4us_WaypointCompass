// DEMO_MODE=true, so SMS and email land in the demo inbox (AC-NTF-15).
import '../../../../test/demo-mode';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { browser, signedInAs } from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import {
  depotFixture,
  outletFixture,
  suffix,
  tripFixture,
} from '../../../../test/fixtures';
import { JobContextRunner } from '../../../core/context/job-context';
import { DemoInbox } from '../../../core/demo/demo-inbox';
import type { DeliveredEvent } from '../../../core/outbox/event-bus';
import type { Database } from '../../../db/client';
import {
  auditEvents,
  devices,
  notificationPreferences,
  notifications,
  orders,
  outboxEvents,
  users,
} from '../../../db/schema';
import { NOTIFICATION_AUDIT } from '../notifications.constants';
import { NotificationDispatcher } from '../services/notification-dispatcher.service';
import {
  NotificationSender,
  ProviderError,
} from '../services/notification-sender.service';

const DAY = '2026-10-02';

/**
 * The pipeline against a real database: the dispatcher is handed events the
 * way the relay hands them (inside a job context and transaction), the sender
 * is driven the way notify.send drives it, and the bell is read over HTTP.
 */
describeWithDb('notifications', () => {
  jest.setTimeout(60_000);

  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  const sfx = suffix();
  let depotId: string;
  let mine: string;
  let other: string;
  let orderId: string;
  let tripId: string;
  let otherTripId: string;
  const people = {} as Record<
    'nimesha' | 'otherStore' | 'tihara' | 'harini' | 'aniqa' | 'dinushi',
    { id: string; cookie: string }
  >;

  const event = (
    type: string,
    payload: Record<string, unknown>,
    routing: Partial<DeliveredEvent> = {},
  ): DeliveredEvent => ({
    id: uuidv7(),
    type,
    depotId,
    outletIds: [],
    userIds: [],
    payload: { v: 1, ...payload },
    occurredAt: new Date(),
    correlationId: null,
    ...routing,
  });
  const dispatch = (e: DeliveredEvent) =>
    app
      .get(JobContextRunner)
      .run({ id: `test:notify:${suffix()}` }, () =>
        app.get(NotificationDispatcher).handle(e),
      );
  const send = (id: string, attempt = 1, last = 4) =>
    app
      .get(JobContextRunner)
      .run(
        { id: `test:send:${suffix()}` },
        () => app.get(NotificationSender).send(id, attempt, last),
        { transaction: false },
      );
  const rowsOf = (eventId: string, userId?: string) =>
    db
      .select()
      .from(notifications)
      .where(
        inArray(
          notifications.dedupeKey,
          ['IN_APP', 'EMAIL', 'SMS', 'PUSH'].flatMap((c) =>
            Object.values(people)
              .filter((p) => !userId || p.id === userId)
              .map((p) => `${eventId}:${p.id}:${c}`),
          ),
        ),
      );
  const channels = async (eventId: string, userId: string) =>
    (await rowsOf(eventId, userId)).map((r) => r.channel).sort();

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    const depot = await depotFixture(db, sfx);
    depotId = depot.plg;
    const where = { depotId, districtId: depot.plgDistrict };
    mine = await outletFixture(db, `NA${sfx}`, where, {
      name: `Fresh Kadawatha ${sfx}`,
    });
    other = await outletFixture(db, `NB${sfx}`, where);

    const as = async (
      name: keyof typeof people,
      input: Parameters<typeof signedInAs>[2],
    ) => {
      const user = await signedInAs(app, db, input);
      people[name] = { id: user.id, cookie: user.cookie };
    };
    await as('nimesha', { role: 'store_manager', outletId: mine });
    await as('otherStore', { role: 'store_manager', outletId: other });
    await as('tihara', { role: 'dispatcher', depotId });
    await as('harini', { role: 'loader', depotId });
    await as('aniqa', { role: 'driver', depotId });
    await as('dinushi', { role: 'driver', depotId });

    // Nimesha has a real address and a phone with push; Aniqa a verified phone only.
    await db
      .update(users)
      .set({ email: `nimesha-${sfx}@example.com` })
      .where(eq(users.id, people.nimesha.id));
    await db.insert(devices).values({
      id: `dev-${sfx}`,
      userId: people.nimesha.id,
      platform: 'WEB',
      pushEndpoint: `https://push.example.com/${sfx}`,
      pushP256dh: 'key',
      pushAuth: 'auth',
    });
    await db
      .update(users)
      .set({
        phoneNumber: `+9477${String(Date.now()).slice(-7)}`,
        phoneNumberVerified: true,
      })
      .where(eq(users.id, people.aniqa.id));

    ({ tripId } = await tripFixture(db, {
      depotId,
      districtId: depot.plgDistrict,
      driverId: people.aniqa.id,
      date: DAY,
    }));
    ({ tripId: otherTripId } = await tripFixture(db, {
      depotId,
      districtId: depot.plgDistrict,
      driverId: people.dinushi.id,
      // One plan per depot and day: Dinushi's trip is on the next one.
      date: '2026-10-03',
    }));
    const [order] = await db
      .insert(orders)
      .values({
        orderNo: `WF-${sfx}`,
        outletId: mine,
        depotId,
        brand: 'FRESH',
        districtId: depot.plgDistrict,
        tempClass: 'CHILLED',
        requestedDate: DAY,
        deliveryDate: DAY,
        status: 'CONFIRMED',
        units: 10,
        weightKg: 100,
        volumeM3: 1,
        source: 'backorder',
      })
      .returning({ id: orders.id });
    orderId = order.id;
  });

  afterAll(async () => {
    await close();
    await app.close();
  });

  const deferralConfirmed = () =>
    event(
      'deferral.confirmed',
      {
        deferralId: uuidv7(),
        orderId,
        orderNo: `WF-${sfx}`,
        reasonCode: 'NO_REEFER_CAPACITY',
        toDate: '2026-10-03',
      },
      { outletIds: [mine], aggregateType: 'deferral', aggregateId: uuidv7() },
    );

  it('AC-NTF-01 One notification per event, person and channel', async () => {
    const e = deferralConfirmed();
    await dispatch(e);

    const rows = await rowsOf(e.id, people.nimesha.id);
    expect(rows.map((r) => r.channel).sort()).toEqual([
      'EMAIL',
      'IN_APP',
      'PUSH',
    ]);
    for (const row of rows)
      expect(row.dedupeKey).toBe(`${e.id}:${people.nimesha.id}:${row.channel}`);
    expect(rows.find((r) => r.channel === 'IN_APP')?.body).toBe(
      `Order WF-${sfx} moves to Sat 3 Oct: no reefer capacity.`,
    );
    // The other outlet's manager hears nothing.
    expect(await rowsOf(e.id, people.otherStore.id)).toEqual([]);

    const email = rows.find((r) => r.channel === 'EMAIL')!;
    expect(await send(email.id)).toBe('sent');
    const push = rows.find((r) => r.channel === 'PUSH')!;
    expect(await send(push.id)).toBe('suppressed');
    const after = await rowsOf(e.id, people.nimesha.id);
    expect(after.find((r) => r.id === email.id)).toMatchObject({
      status: 'SENT',
      provider: 'demo-inbox',
      providerMessageId: expect.stringMatching(/^demo-/) as string,
    });
  });

  it('AC-NTF-02 A replayed event never sends twice', async () => {
    const e = deferralConfirmed();
    expect((await dispatch(e)).created).toBe(3);
    expect((await dispatch(e)).created).toBe(0);
    expect(await rowsOf(e.id, people.nimesha.id)).toHaveLength(3);
  });

  it('AC-NTF-03 Preferences drop a channel but never in-app', async () => {
    await db.insert(notificationPreferences).values({
      userId: people.nimesha.id,
      eventType: 'order.rolled_to_next_run',
      channels: ['PUSH'],
    });
    const e = event(
      'order.rolled_to_next_run',
      {
        orderId,
        outletId: mine,
        deliveryDate: '2026-10-03',
        reason: 'AFTER_CUTOFF',
      },
      { outletIds: [mine] },
    );
    await dispatch(e);
    expect(await channels(e.id, people.nimesha.id)).toEqual(['IN_APP', 'PUSH']);
  });

  it("AC-NTF-04 Channels a person can't receive are dropped", async () => {
    const e = event(
      'plan.published',
      { planId: uuidv7(), date: DAY, tripIds: [tripId] },
      { outletIds: [mine], aggregateType: 'plan' },
    );
    await dispatch(e);
    expect(await channels(e.id, people.aniqa.id)).toEqual(['IN_APP', 'SMS']);
    const [sms] = (await rowsOf(e.id, people.aniqa.id)).filter(
      (r) => r.channel === 'SMS',
    );
    expect(sms.body).toMatch(/^Your trip: DRY-\w+/);
    // The depot's loader and the store hear about it too; the other driver does not.
    expect(await channels(e.id, people.harini.id)).toEqual(['IN_APP']);
    expect(await channels(e.id, people.nimesha.id)).toEqual([
      'EMAIL',
      'IN_APP',
    ]);
    expect(await rowsOf(e.id, people.dinushi.id)).toEqual([]);
  });

  it('AC-NTF-06 Retryable failures back off, then fail', async () => {
    const e = deferralConfirmed();
    await dispatch(e);
    const email = (await rowsOf(e.id, people.nimesha.id)).find(
      (r) => r.channel === 'EMAIL',
    )!;
    const sender = app.get(NotificationSender);
    const real = sender.deliver;
    sender.deliver = () =>
      Promise.reject(new ProviderError('provider timed out', true));
    try {
      expect(await send(email.id, 1, 4)).toBe('retry');
      let [row] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, email.id));
      expect(row).toMatchObject({ status: 'QUEUED', attempts: 1 });
      expect(await send(email.id, 4, 4)).toBe('failed');
      [row] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, email.id));
      expect(row).toMatchObject({
        status: 'FAILED',
        attempts: 2,
        error: 'provider timed out',
      });
    } finally {
      sender.deliver = real;
    }
  });

  it('AC-NTF-07 A permanent failure is not retried', async () => {
    const e = deferralConfirmed();
    await dispatch(e);
    const email = (await rowsOf(e.id, people.nimesha.id)).find(
      (r) => r.channel === 'EMAIL',
    )!;
    const sender = app.get(NotificationSender);
    const real = sender.deliver;
    sender.deliver = () =>
      Promise.reject(new ProviderError('invalid address', false));
    try {
      expect(await send(email.id, 1, 4)).toBe('failed');
      const [row] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, email.id));
      expect(row).toMatchObject({ status: 'FAILED', attempts: 1 });
    } finally {
      sender.deliver = real;
    }
  });

  it("AC-NTF-09 Reading a store's deferral notice is audited", async () => {
    const e = deferralConfirmed();
    await dispatch(e);
    const inApp = (await rowsOf(e.id, people.nimesha.id)).find(
      (r) => r.channel === 'IN_APP',
    )!;
    const read = () =>
      request(app.getHttpServer())
        .post(`/api/v1/me/notifications/${inApp.id}/read`)
        .set(browser())
        .set('Cookie', people.nimesha.cookie);

    const res = await read().expect(200);
    expect(
      (res.body as { data: { readAt: string | null } }).data.readAt,
    ).toEqual(expect.any(String));
    await read().expect(200);
    const audits = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, NOTIFICATION_AUDIT.read),
          eq(auditEvents.entityId, inApp.id),
        ),
      );
    expect(audits).toHaveLength(1);

    // Someone else's notification is a 404, like a missing one.
    await request(app.getHttpServer())
      .post(`/api/v1/me/notifications/${inApp.id}/read`)
      .set(browser())
      .set('Cookie', people.otherStore.cookie)
      .expect(404);
  });

  it('AC-NTF-11 A revision reaches only the people it affects', async () => {
    const e = event(
      'plan.revised',
      { planId: uuidv7(), date: DAY, revision: 2, tripIds: [tripId] },
      { outletIds: [mine], aggregateType: 'plan' },
    );
    await dispatch(e);
    expect(await channels(e.id, people.aniqa.id)).toEqual(['IN_APP']);
    expect(await channels(e.id, people.nimesha.id)).toEqual(['IN_APP', 'PUSH']);
    expect(await rowsOf(e.id, people.dinushi.id)).toEqual([]);
    expect(await rowsOf(e.id, people.otherStore.id)).toEqual([]);
    expect(otherTripId).toBeTruthy();
  });

  it('AC-NTF-13 The bell lists only my notifications', async () => {
    const e = deferralConfirmed();
    await dispatch(e);
    const bell = (cookie: string, path = '?limit=20') =>
      request(app.getHttpServer())
        .get(`/api/v1/me/notifications${path}`)
        .set(browser())
        .set('Cookie', cookie)
        .expect(200);

    const res = await bell(people.nimesha.cookie);
    const body = res.body as {
      data: { id: string; title: string; _links: Record<string, unknown> }[];
      meta: {
        page: { limit: number; nextCursor: string | null; hasMore: boolean };
      };
    };
    const own = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, people.nimesha.id),
          eq(notifications.channel, 'IN_APP'),
        ),
      );
    expect(body.data.map((n) => n.id).sort()).toEqual(
      own.map((n) => n.id).sort(),
    );
    expect(body.meta.page).toMatchObject({ limit: 20, hasMore: false });
    expect(body.data[0].title).toBe(`Order WF-${sfx} moves to Sat 3 Oct`);

    const theirs = await bell(people.otherStore.cookie);
    expect((theirs.body as { data: unknown[] }).data).toEqual([]);

    const summary = await bell(people.nimesha.cookie, '/summary');
    const unread = (summary.body as { data: { unread: number } }).data.unread;
    expect(unread).toBeGreaterThan(0);

    // Each in-app row is announced to its user, which the stream carries to the bell.
    const inApp = (await rowsOf(e.id, people.nimesha.id)).find(
      (r) => r.channel === 'IN_APP',
    )!;
    const [announced] = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.type, 'notification.created'),
          eq(outboxEvents.aggregateId, inApp.id),
        ),
      );
    expect(announced.userIds).toEqual([people.nimesha.id]);

    await request(app.getHttpServer())
      .post('/api/v1/me/notifications/read-all')
      .set(browser())
      .set('Cookie', people.nimesha.cookie)
      .expect(200);
    const cleared = await bell(people.nimesha.cookie, '/summary');
    expect((cleared.body as { data: { unread: number } }).data.unread).toBe(0);
  });

  it('AC-NTF-15 The demo inbox shows what each person received', async () => {
    const e = event(
      'trip.released',
      { tripId },
      { aggregateType: 'trip', aggregateId: tripId, outletIds: [] },
    );
    await dispatch(e);
    const sms = (await rowsOf(e.id, people.aniqa.id)).find(
      (r) => r.channel === 'SMS',
    )!;
    expect(await send(sms.id)).toBe('sent');
    const [phone] = await db
      .select({ phone: users.phoneNumber })
      .from(users)
      .where(eq(users.id, people.aniqa.id));
    const inbox = await app.get(DemoInbox).list();
    expect(inbox.find((m) => m.to === phone.phone)).toMatchObject({
      channel: 'sms',
      body: expect.stringMatching(/^Waypoint: DRY-\w+ released\./) as string,
    });
  });
});
