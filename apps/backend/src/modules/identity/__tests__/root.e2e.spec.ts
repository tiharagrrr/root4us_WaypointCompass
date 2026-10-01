import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Link } from '@waypoint/shared';
import request from 'supertest';
import { bodyOf, browser, signedInAs } from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import { depotFixture, outletFixture, suffix } from '../../../../test/fixtures';
import { ClockService } from '../../../core/clock/clock.service';
import type { Database } from '../../../db/client';

interface Root {
  data: {
    actor: Record<string, unknown>;
    _links: Record<string, Link>;
  };
  meta: { serverTime: string };
}

describeWithDb('API root', () => {
  jest.setTimeout(30_000);

  const sfx = suffix();
  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;

  const root = async (cookie: string) =>
    bodyOf<Root>(
      await request(app.getHttpServer())
        .get('/api/v1')
        .set(browser())
        .set('Cookie', cookie)
        .expect(200),
    );

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
  });

  afterAll(async () => {
    app.get(ClockService).reset();
    await close();
    await app.close();
  });

  it('AC-IDN-12 dispatcher root lists landing links', async () => {
    const tihara = await signedInAs(app, db, {
      role: 'dispatcher',
      name: 'Tihara Egodage',
      depotId: null,
    });
    app.get(ClockService).freeze('2026-10-01T15:12:00+05:30');

    const body = await root(tihara.cookie);

    expect(body.data.actor).toEqual({
      id: tihara.id,
      name: 'Tihara Egodage',
      role: 'dispatcher',
      depotId: null,
    });
    const links = body.data._links;
    expect(Object.keys(links).sort()).toEqual(
      [
        'self',
        'me',
        'today',
        'tomorrowPlan',
        'orders',
        'alerts',
        'tracking',
        'events',
        'docs',
      ].sort(),
    );
    expect(links.self.href).toBe('/api/v1');
    expect(links.me.href).toBe('/api/v1/me');
    expect(links.today.href).toBe('/api/v1/depots/PLG/days/2026-10-01');
    expect(links.tomorrowPlan.href).toBe('/api/v1/depots/PLG/plans/2026-10-02');
    expect(links.orders).toMatchObject({ templated: true });
    expect(links.orders.href).toMatch(/^\/api\/v1\/orders\{/);
    expect(links.alerts.href).toBe('/api/v1/alerts?filter[status]=OPEN');
    expect(links.tracking.href).toBe('/api/v1/depots/PLG/tracking');
    expect(links.events.href).toBe('/api/v1/streams/me');
    expect(links.docs.href).toBe('/api/docs');
    expect(body.meta.serverTime).toBe('2026-10-01T15:12:00+05:30');
  });

  it('AC-IDN-13 field roles get their landing links', async () => {
    const depot = await depotFixture(db, sfx);
    const kadawatha = await outletFixture(db, `OUT014-${sfx}`, {
      depotId: depot.plg,
      districtId: depot.plgDistrict,
    });
    const [aniqa, harini, nimesha] = await Promise.all([
      signedInAs(app, db, {
        role: 'driver',
        name: 'Aniqa Razick',
        depotId: depot.plg,
      }),
      signedInAs(app, db, {
        role: 'loader',
        name: 'Harini De Mel',
        depotId: depot.plg,
      }),
      signedInAs(app, db, {
        role: 'store_manager',
        name: 'Nimesha Periyapperuma',
        outletId: kadawatha,
      }),
    ]);

    const links = {
      aniqa: (await root(aniqa.cookie)).data._links,
      harini: (await root(harini.cookie)).data._links,
      nimesha: (await root(nimesha.cookie)).data._links,
    };

    expect(links.aniqa).toHaveProperty('myTrips');
    expect(links.harini).toHaveProperty('loadingBoard');
    expect(links.harini.loadingBoard.href).toMatch(
      new RegExp(`^/api/v1/depots/${depot.plg}/loading/runs\\?date=`),
    );
    expect(links.nimesha).toHaveProperty('myOrders');
    expect(links.nimesha).toHaveProperty('deliveries');
    for (const own of Object.values(links)) {
      expect(own).not.toHaveProperty('today');
      expect(own).not.toHaveProperty('tomorrowPlan');
      expect(own).not.toHaveProperty('tracking');
    }
  });
});
