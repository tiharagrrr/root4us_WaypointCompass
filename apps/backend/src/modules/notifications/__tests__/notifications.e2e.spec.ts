// DEMO_MODE=true, so SMS and email land in the demo inbox (AC-NTF-15).
import '../../../../test/demo-mode';
// A Resend signing secret, so the suite signs receipts the way Resend does (AC-NTF-08).
import { TEST_WEBHOOK_SECRET } from './webhook-secret';
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
import { OutboxRelay } from '../../../core/outbox/outbox-relay.service';
import { PresenceService } from '../../realtime';
import { signSvix } from '../../webhooks';
import { DemoInbox } from '../../../core/demo/demo-inbox';
import type { DeliveredEvent } from '../../../core/outbox/event-bus';
import type { Database } from '../../../db/client';
import {
  auditEvents,
  devices,
  inboundWebhookEvents,
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

  it('AC-NTF-10 Small ETA slips stay quiet and bursts collapse', async () => {
    const stopId = uuidv7();
    const eta = (slipMin: number) =>
      event(
        'eta.updated',
        {
          tripId,
          stopId,
          orderId,
          outletId: mine,
          etaAt: '2026-10-02T01:40:00.000Z',
          slipMin,
        },
        { outletIds: [mine], aggregateType: 'stop', aggregateId: stopId },
      );

    const small = eta(10);
    await dispatch(small);
    expect(await rowsOf(small.id, people.nimesha.id)).toEqual([]);

    const big = eta(15);
    await dispatch(big);
    const told = await rowsOf(big.id, people.nimesha.id);
    expect(told.map((r) => r.channel).sort()).toEqual(['IN_APP', 'PUSH']);
    expect(told[0].body).toBe('Now arriving around 07:10.');

    // Nine more updates in the same burst: still one notice.
    for (let i = 1; i <= 9; i += 1) {
      const again = eta(15 + i);
      await dispatch(again);
      expect(await rowsOf(again.id, people.nimesha.id)).toEqual([]);
    }
  });

  it('AC-NTF-12 No push while the person is watching', async () => {
    const presence = app.get(PresenceService);
    await presence.opened(people.nimesha.id);
    try {
      const watched = deferralConfirmed();
      await dispatch(watched);
      expect(await channels(watched.id, people.nimesha.id)).toEqual([
        'EMAIL',
        'IN_APP',
      ]);
    } finally {
      await presence.closed(people.nimesha.id);
    }
    const away = deferralConfirmed();
    await dispatch(away);
    expect(await channels(away.id, people.nimesha.id)).toEqual([
      'EMAIL',
      'IN_APP',
      'PUSH',
    ]);
  });

  it('AC-NTF-14 Templates fit their channel', async () => {
    const res = await request(app.getHttpServer())
      .get(
        '/api/v1/dev/notifications/preview/trip.released?channel=sms&locale=si',
      )
      .set(browser())
      .set('Cookie', people.tihara.cookie)
      .expect(200);
    const body = res.body as {
      data: { locale: string; audiences: { rendered: { text: string } }[] };
    };
    expect(body.data.locale).toBe('en');
    expect(body.data.audiences[0].rendered.text).toBe(
      'Waypoint: REF-07 trip 1 released. 6 stops, first Fresh Kadawatha at 04:10. Open the app to start.',
    );
    await request(app.getHttpServer())
      .get('/api/v1/dev/notifications/preview/nope.never')
      .set(browser())
      .set('Cookie', people.tihara.cookie)
      .expect(404);
  });

  it('lets a person choose their channels, never dropping in-app', async () => {
    const prefs = (cookie: string) =>
      request(app.getHttpServer())
        .get('/api/v1/me/notification-preferences')
        .set(browser())
        .set('Cookie', cookie)
        .expect(200);
    const put = (cookie: string, eventType: string, chosen: string[]) =>
      request(app.getHttpServer())
        .put(`/api/v1/me/notification-preferences/${eventType}`)
        .set(browser())
        .set('Cookie', cookie)
        .send({ channels: chosen });
    type Item = {
      eventType: string;
      defaults: string[];
      available: string[];
      channels: string[];
      custom: boolean;
      _links: Record<string, unknown>;
    };
    const itemOf = async (cookie: string, eventType: string) =>
      (
        (await prefs(cookie)).body as { data: { items: Item[] } }
      ).data.items.find((i) => i.eventType === eventType);

    expect(
      await itemOf(people.nimesha.cookie, 'deferral.confirmed'),
    ).toMatchObject({
      defaults: ['IN_APP', 'EMAIL', 'PUSH'],
      available: ['IN_APP', 'EMAIL', 'PUSH'],
      channels: ['IN_APP', 'EMAIL', 'PUSH'],
      custom: false,
      _links: { update: { method: 'PUT' } },
    });
    // A driver with no push and no real email is offered what reaches her.
    expect(await itemOf(people.aniqa.cookie, 'trip.released')).toMatchObject({
      defaults: ['IN_APP', 'SMS', 'PUSH'],
      available: ['IN_APP', 'SMS'],
    });

    const saved = await put(people.nimesha.cookie, 'deferral.confirmed', [
      'PUSH',
    ]).expect(200);
    expect((saved.body as { data: Item }).data).toMatchObject({
      channels: ['IN_APP', 'PUSH'],
      custom: true,
    });
    await put(people.nimesha.cookie, 'deferral.confirmed', ['SMS']).expect(400);
    await put(people.nimesha.cookie, 'load.flag_raised', ['PUSH']).expect(404);
    await put(people.nimesha.cookie, 'deferral.confirmed', [
      'EMAIL',
      'PUSH',
    ]).expect(200);
  });

  // Last: a bounce switches Nimesha's email off for the rest of the suite.
  it('AC-NTF-08 Provider receipts move the status', async () => {
    const sender = app.get(NotificationSender);
    const real = sender.deliver;
    const sentVia = async (messageId: string) => {
      const e = deferralConfirmed();
      await dispatch(e);
      const email = (await rowsOf(e.id, people.nimesha.id)).find(
        (r) => r.channel === 'EMAIL',
      )!;
      sender.deliver = () => Promise.resolve({ provider: 'resend', messageId });
      try {
        expect(await send(email.id)).toBe('sent');
      } finally {
        sender.deliver = real;
      }
      return email.id;
    };
    const webhook = (
      type: string,
      emailId: string,
      opts: { id?: string; bad?: boolean } = {},
    ) => {
      const id = opts.id ?? `msg_${uuidv7()}`;
      const ts = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({
        type,
        created_at: new Date().toISOString(),
        data: { email_id: emailId },
      });
      return request(app.getHttpServer())
        .post('/api/v1/webhooks/resend')
        .set('content-type', 'application/json')
        .set('svix-id', id)
        .set('svix-timestamp', ts)
        .set(
          'svix-signature',
          opts.bad ? 'v1,AAAA' : signSvix(TEST_WEBHOOK_SECRET, id, ts, body),
        )
        .send(body);
    };
    const relay = (type: string) =>
      app.get(OutboxRelay).drain({ types: [type] });
    const rowOf = async (id: string) =>
      (
        await db.select().from(notifications).where(eq(notifications.id, id))
      )[0];

    const delivered = `re_${sfx}_delivered`;
    const deliveredRow = await sentVia(delivered);
    const svixId = `msg_${uuidv7()}`;
    await webhook('email.delivered', delivered, { id: svixId }).expect(200);
    // Resend retries: the same svix-id is accepted once.
    await webhook('email.delivered', delivered, { id: svixId }).expect(200);
    await relay('email.delivered');
    expect(await rowOf(deliveredRow)).toMatchObject({ status: 'DELIVERED' });
    expect((await rowOf(deliveredRow)).deliveredAt).toBeInstanceOf(Date);
    const kept = await db
      .select()
      .from(inboundWebhookEvents)
      .where(
        and(
          eq(inboundWebhookEvents.provider, 'resend'),
          eq(inboundWebhookEvents.externalId, svixId),
        ),
      );
    expect(kept).toHaveLength(1);

    // A forged call is refused and kept, with signatureOk false.
    await webhook('email.delivered', delivered, { bad: true }).expect(401);

    const bounced = `re_${sfx}_bounced`;
    const bouncedRow = await sentVia(bounced);
    await webhook('email.bounced', bounced).expect(200);
    await relay('email.bounced');
    expect(await rowOf(bouncedRow)).toMatchObject({
      status: 'FAILED',
      error: 'Email bounced',
    });
    // Her email is off for everything until she turns it back on.
    const after = deferralConfirmed();
    await dispatch(after);
    expect(await channels(after.id, people.nimesha.id)).toEqual([
      'IN_APP',
      'PUSH',
    ]);
    const sheet = await request(app.getHttpServer())
      .get('/api/v1/me/notification-preferences')
      .set(browser())
      .set('Cookie', people.nimesha.cookie)
      .expect(200);
    expect(
      (
        sheet.body as {
          data: { emailSuppressed: boolean; _links: Record<string, unknown> };
        }
      ).data,
    ).toMatchObject({
      emailSuppressed: true,
      _links: { resumeEmail: { method: 'POST' } },
    });
    const resumed = await request(app.getHttpServer())
      .post('/api/v1/me/notification-preferences/resume-email')
      .set(browser())
      .set('Cookie', people.nimesha.cookie)
      .expect(200);
    expect(
      (resumed.body as { data: { emailSuppressed: boolean } }).data
        .emailSuppressed,
    ).toBe(false);
  });
});
