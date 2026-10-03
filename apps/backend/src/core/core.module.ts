import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthGuard } from '@thallesp/nestjs-better-auth';
import { AttachmentsModule } from './attachments/attachments.module';
import { ActorGuard } from './auth/actor.guard';
import { PermissionGuard } from './auth/permission.guard';
import { EnvelopeInterceptor } from './http/envelope.interceptor';
import { IdempotencyInterceptor } from './http/idempotency.interceptor';
import { ProblemDetailsFilter } from './http/problem-details.filter';
import { ClockSync } from './clock/clock-sync.service';
import { DemoDay } from './demo/demo-day';
import { SeedDemoDayBuilder } from './demo/seed-demo-day.builder';
import { KernelModule } from './kernel.module';
import { EventBus } from './outbox/event-bus';
import { EventPublisher } from './outbox/event-publisher';
import { OutboxRelay } from './outbox/outbox-relay.service';
import { OutboxService } from './outbox/outbox.service';
import { SettingsService } from './settings/settings.service';
import { ActorTransactionInterceptor } from './persistence/actor-transaction.interceptor';
import { StorageModule } from './storage/storage.module';

/**
 * The request pipeline every module shares (specs/api-conventions.md,
 * section 6), on top of the kernel. Global guards run in the order listed:
 * BetterAuth resolves the session (401 without one, unless @AllowAnonymous),
 * ActorGuard builds the Actor, PermissionGuard checks @RequirePermission
 * (403). Interceptors nest in the order listed: the request's transaction
 * outside, the envelope inside it, and @UseIdempotency() innermost.
 */
@Global()
@Module({
  imports: [KernelModule, StorageModule, AttachmentsModule],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ActorGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: ActorTransactionInterceptor },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    IdempotencyInterceptor,
    OutboxService,
    EventBus,
    EventPublisher,
    OutboxRelay,
    SettingsService,
    ClockSync,
    DemoDay,
    SeedDemoDayBuilder,
  ],
  exports: [
    KernelModule,
    StorageModule,
    AttachmentsModule,
    IdempotencyInterceptor,
    OutboxService,
    EventBus,
    OutboxRelay,
    SettingsService,
    ClockSync,
    DemoDay,
  ],
})
export class CoreModule {}
