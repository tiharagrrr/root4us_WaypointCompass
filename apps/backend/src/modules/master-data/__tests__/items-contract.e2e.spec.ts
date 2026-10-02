import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  bodyOf,
  browser,
  type Problem,
  signedInAs,
} from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import { suffix } from '../../../../test/fixtures';
import type { Database } from '../../../db/client';

/**
 * The catalog contract behind M1a's picker: the routes are mounted, every
 * role that places or checks an order may read them, and a role without
 * `catalog:read` is refused. What the list returns is AC-MD-08, in
 * master-data.e2e.spec.ts.
 */
describeWithDb('catalog contract', () => {
  jest.setTimeout(30_000);

  const MISSING_ITEM = '0192a3f4-0000-7000-8000-00000000b001';
  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
  });

  afterAll(async () => {
    await close();
    await app.close();
  });

  const get = async (path: string, cookie: string) =>
    request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set(browser())
      .set('Cookie', cookie);

  it('the store manager reads the catalog', async () => {
    const store = await signedInAs(app, db, {
      role: 'store_manager',
      outletId: null,
      name: `Store ${suffix()}`,
    });

    const list = await get(
      '/items?filter[tempClass]=AMBIENT&limit=100',
      store.cookie,
    );

    expect(list.status).toBe(200);
    const page = list.body as {
      data: unknown[];
      meta: { page: { limit: number } };
      _links: Record<string, unknown>;
    };
    expect(Array.isArray(page.data)).toBe(true);
    expect(page.meta.page.limit).toBe(100);
    expect(page._links.self).toBeDefined();

    // An id nothing matches is a 404, not an empty resource.
    const missing = await get(`/items/${MISSING_ITEM}`, store.cookie);
    expect(missing.status).toBe(404);
    expect(bodyOf<Problem>(missing).code).toBe('NOT_FOUND');
  });

  it('a driver has no catalog:read and is refused', async () => {
    const driver = await signedInAs(app, db, { role: 'driver' });

    const res = await get('/items', driver.cookie);

    expect(res.status).toBe(403);
    expect(bodyOf<Problem>(res).code).toBe('FORBIDDEN');
  });
});
