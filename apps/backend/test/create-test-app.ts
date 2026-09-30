import type { Provider, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createDatabase, createPool, type Database } from '../src/db/client';

/**
 * The e2e suites need a migrated database with the three roles (and Redis):
 *
 *   TEST_DIRECT_URL=postgres://compass_owner:...@localhost:5432/waypoint \
 *   TEST_DATABASE_URL=postgres://compass_app:...@localhost:5432/waypoint \
 *   TEST_REDIS_URL=redis://localhost:6379 pnpm --filter api test
 *
 * Without the database URLs they are skipped. Fixture ids carry a random
 * suffix, so suites can run repeatedly against the same local database.
 */
export const describeWithDb =
  process.env.TEST_DATABASE_URL && process.env.TEST_DIRECT_URL
    ? describe
    : describe.skip;

/** Boots AppModule the way main.ts does, plus any test-only controllers or providers. */
export async function createTestApp(
  extra: { controllers?: Type[]; providers?: Provider[] } = {},
): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: extra.controllers ?? [],
    providers: extra.providers ?? [],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: ['error', 'warn'],
  });
  configureApp(app);
  await app.init();
  return app;
}

/** compass_owner, which bypasses row-level security: for fixtures and assertions only. */
export function ownerDatabase(): { db: Database; close: () => Promise<void> } {
  const pool = createPool(process.env.TEST_DIRECT_URL!);
  return { db: createDatabase(pool), close: () => pool.end() };
}
