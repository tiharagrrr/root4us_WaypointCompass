import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { bodyOf, browser, signedInAs } from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import { depotFixture, suffix } from '../../../../test/fixtures';
import { expectProblem } from '../../../../test/kernel';
import { ClockSync } from '../../../core/clock/clock-sync.service';
import { SettingsService } from '../../../core/settings/settings.service';
import { SETTING_KEYS } from '../../../core/settings/settings.registry';
import type { Database } from '../../../db/client';
import { auditEvents, outboxEvents, settings } from '../../../db/schema';

interface SettingBody {
  key: string;
  value: unknown;
  source: string;
}

/** Global rows these tests change; restored afterwards, since the local database is shared. */
const TOUCHED = [
  'ordering.cutoffMin',
  'ordering.cutoffReminderMin',
  'loading.maxReleaseTempC',
  'tracking.offlineAlertMinutes',
];

describeWithDb('/settings', () => {
  jest.setTimeout(30_000);

  const sfx = suffix();
  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  let depot: Awaited<ReturnType<typeof depotFixture>>;
  let rusiru: Awaited<ReturnType<typeof signedInAs>>;
  let tihara: Awaited<ReturnType<typeof signedInAs>>;
  let saved: (typeof settings.$inferSelect)[] = [];

  const as = (cookie: string) => {
    const server = app.getHttpServer();
    const signed = <T extends request.Test>(r: T) =>
      r.set(browser()).set('Cookie', cookie);
    return {
      get: (path: string) => signed(request(server).get(path)),
      put: (path: string, body: object) =>
        signed(request(server).put(path)).send(body),
      post: (path: string) => signed(request(server).post(path)).send({}),
    };
  };
  const globalRows = (keys: string[]) =>
    db
      .select()
      .from(settings)
      .where(and(inArray(settings.key, keys), eq(settings.scope, 'global')));
  const clearGlobal = (keys: string[]) =>
    db
      .delete(settings)
      .where(and(inArray(settings.key, keys), eq(settings.scope, 'global')));
  const changedEvents = (key: string) =>
    db.$count(
      outboxEvents,
      and(
        eq(outboxEvents.type, 'settings.changed'),
        eq(outboxEvents.aggregateId, key),
      ),
    );
  const changeAudits = (key: string) =>
    db.$count(
      auditEvents,
      and(
        eq(auditEvents.action, 'core.setting.changed'),
        eq(auditEvents.entityId, key),
      ),
    );

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    depot = await depotFixture(db, sfx);
    rusiru = await signedInAs(app, db, { role: 'admin' });
    tihara = await signedInAs(app, db, {
      role: 'dispatcher',
      name: 'Tihara Egodage',
    });
    saved = await globalRows(TOUCHED);
    await clearGlobal(TOUCHED);
  });

  afterAll(async () => {
    await clearGlobal(TOUCHED);
    if (saved.length) await db.insert(settings).values(saved);
    await close();
    await app.close();
  });

  it('AC-IDN-49 dispatchers read settings', async () => {
    const res = await as(tihara.cookie).get('/api/v1/settings').expect(200);
    const list = bodyOf<{ data: SettingBody[] }>(res).data;
    expect(list.map((s) => s.key).sort()).toEqual([...SETTING_KEYS].sort());
    const value = (key: string) => list.find((s) => s.key === key)?.value;
    expect(value('ordering.cutoffMin')).toBe(960);
    expect(value('ordering.cutoffReminderMin')).toBe(930);
    expect(value('loading.maxReleaseTempC')).toBe(5.0);
  });

  it('AC-IDN-50 a setting must match its schema', async () => {
    const key = 'ordering.cutoffReminderMin';
    const events = await changedEvents(key);
    const res = await as(rusiru.cookie).put(`/api/v1/settings/${key}`, {
      value: '15:30',
    });
    expect(res.status).toBe(400);
    expectProblem(res, 'VALIDATION_FAILED');
    expect(await globalRows([key])).toEqual([]);
    expect(await changedEvents(key)).toBe(events);
  });

  it('AC-IDN-51 a setting change is audited and broadcast', async () => {
    const key = 'ordering.cutoffReminderMin';
    const [events, audits] = [
      await changedEvents(key),
      await changeAudits(key),
    ];
    const res = await as(rusiru.cookie)
      .put(`/api/v1/settings/${key}`, { value: 945 })
      .expect(200);
    expect(bodyOf<{ data: SettingBody }>(res).data).toMatchObject({
      key,
      value: 945,
      source: 'global',
    });

    const [row] = await globalRows([key]);
    expect(row).toMatchObject({ value: 945, updatedById: rusiru.id });
    expect(await changeAudits(key)).toBe(audits + 1);
    expect(await changedEvents(key)).toBe(events + 1);
  });

  it('AC-IDN-52 settings resolve override, global, then default', async () => {
    await clearGlobal(['ordering.cutoffMin', 'tracking.offlineAlertMinutes']);
    await db
      .insert(settings)
      .values({ key: 'ordering.cutoffMin', scope: depot.plg, value: 930 });
    const service = app.get(SettingsService);

    for (const depotId of [depot.plg, depot.kdy])
      expect(await service.get('tracking.offlineAlertMinutes', depotId)).toBe(
        30,
      );
    expect(await service.get('ordering.cutoffMin', depot.plg)).toBe(930);
    expect(await service.get('ordering.cutoffMin', depot.kdy)).toBe(960);

    const res = await as(tihara.cookie)
      .get(`/api/v1/settings/ordering.cutoffMin?depotId=${depot.plg}`)
      .expect(200);
    expect(bodyOf<{ data: SettingBody }>(res).data).toMatchObject({
      value: 930,
      source: 'depot',
    });
  });

  it('AC-IDN-56 demo mode off disables time travel', async () => {
    // Other suites write demo.clock too, so look only at what these requests wrote.
    const correlationId = `ac-idn-56-${sfx}`;
    const server = app.getHttpServer();
    const send = <T extends request.Test>(r: T) =>
      r
        .set(browser())
        .set('Cookie', rusiru.cookie)
        .set('x-correlation-id', correlationId);

    for (const res of [
      await send(request(server).put('/api/v1/clock')).send({
        mode: 'frozen',
        at: '2026-10-01T15:55:00+05:30',
      }),
      await send(request(server).post('/api/v1/demo/reset')).send({}),
      await send(request(server).get('/api/v1/demo/inbox')),
    ]) {
      expect(res.status).toBe(404);
      expectProblem(res, 'NOT_FOUND');
    }
    const [clockRow] = await globalRows(['demo.clock']);
    expect(clockRow?.updatedById).not.toBe(rusiru.id);
    expect(
      await db.$count(
        outboxEvents,
        eq(outboxEvents.correlationId, correlationId),
      ),
    ).toBe(0);
    expect(
      await db.$count(
        auditEvents,
        eq(auditEvents.correlationId, correlationId),
      ),
    ).toBe(0);

    // Even when demo.clock holds a frozen mode, the clock follows the wall clock.
    app
      .get(ClockSync)
      .adopt({ mode: 'frozen', at: '2026-10-01T15:55:00+05:30' });
    const me = await as(rusiru.cookie).get('/api/v1/me').expect(200);
    const serverTime = Date.parse(
      bodyOf<{ meta: { serverTime: string } }>(me).meta.serverTime,
    );
    expect(Math.abs(serverTime - Date.now())).toBeLessThan(5_000);
  });
});
