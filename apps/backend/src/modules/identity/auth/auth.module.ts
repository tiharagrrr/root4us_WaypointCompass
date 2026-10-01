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
          trustedOrigins: config.get('TRUSTED_ORIGINS', { infer: true }),
          enableBearer: config.get('ENABLE_BEARER', { infer: true }),
          sendOtp: (phone, code) => messages.enqueueOtp(phone, code),
        }),
    },
  ],
  exports: [AUTH],
})
export class IdentityAuthModule {}
