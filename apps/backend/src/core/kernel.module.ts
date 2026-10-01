import { Global, Module } from '@nestjs/common';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import type { Request, Response } from 'express';
import { ClsModule } from 'nestjs-cls';
import { AppConfig } from '../config/app-config';
import { DatabaseModule } from '../db/database.module';
import { ClockService } from './clock/clock.service';
import { JobContextRunner } from './context/job-context';
import {
  correlationIdOf,
  deviceIdOf,
  ensureRequestId,
  RequestContext,
} from './context/request-context';
import { AppLoggerModule } from './observability/logger.module';
import { CrudQueryService } from './persistence/crud-query.service';
import { StampedDrizzleAdapter } from './persistence/transactions';

const providers = [
  AppConfig,
  ClockService,
  RequestContext,
  JobContextRunner,
  CrudQueryService,
];

/**
 * What the API and the worker share: typed config, the CLS context with
 * transactions that follow it (every one stamped for row-level security),
 * pino logging, the clock and the generic queries. Step 2 of the request
 * lifecycle happens here: the CLS middleware opens a context per request with
 * its request id, correlation id and device id.
 */
@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: Request) => ensureRequestId(req),
        // Keys of AppClsStore (context/request-context.ts).
        setup: (cls, req: Request, res: Response) => {
          cls.set('correlationId', correlationIdOf(req));
          cls.set('deviceId', deviceIdOf(req));
          res.setHeader('x-request-id', cls.getId());
        },
      },
      plugins: [
        new ClsPluginTransactional({
          imports: [DatabaseModule],
          adapter: new StampedDrizzleAdapter(),
        }),
      ],
    }),
    AppLoggerModule,
  ],
  providers,
  exports: providers,
})
export class KernelModule {}
