import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DB } from '../../../db/database.module';
import type { Database } from '../../../db/client';
import type { Env } from '../../../config/env.schema';
import { QUEUES } from '../../../queues';
import { AuthMessages } from './auth-messages';
import { createAuth } from './auth';

/** The BetterAuth instance, for identity services that call auth.api or its hasher. */
export const AUTH = Symbol('AUTH');

/** The Vite dev server's origins; `pnpm dev` serves the app there while APP_URL is Caddy's :8080. */
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/**
 * Origins allowed to call /api/auth besides APP_URL. Outside production the
 * dev server is always trusted, so a fresh checkout can sign in without a
 * TRUSTED_ORIGINS line (BetterAuth answers 403 "Invalid origin" otherwise).
 */
export function trustedOrigins(config: ConfigService<Env, true>): string[] {
  const configured = config.get('TRUSTED_ORIGINS', { infer: true });
  const dev =
    config.get('NODE_ENV', { infer: true }) === 'production' ? [] : DEV_ORIGINS;
  return [...new Set([...configured, ...dev])];
}

/**
 * Builds BetterAuth from Nest's database and config, so it shares the API's
 * pool. IdentityModule hands it to AuthModule.forRootAsync, which mounts
 * /api/auth.
 */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.notifications })],
  providers: [
    AuthMessages,
    {
      provide: AUTH,
      inject: [DB, ConfigService, AuthMessages],
      useFactory: (
        db: Database,
        config: ConfigService<Env, true>,
        messages: AuthMessages,
      ) =>
        createAuth({
          db,
          secret: config.get('BETTER_AUTH_SECRET', { infer: true }),
          appUrl: config.get('APP_URL', { infer: true }),
          trustedOrigins: trustedOrigins(config),
          enableBearer: config.get('ENABLE_BEARER', { infer: true }),
          demoMode: config.get('DEMO_MODE', { infer: true }),
          sendOtp: (phone, code) => messages.enqueueOtp(phone, code),
        }),
    },
  ],
  exports: [AUTH, AuthMessages],
})
export class IdentityAuthModule {}
