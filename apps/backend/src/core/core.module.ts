import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthGuard } from '@thallesp/nestjs-better-auth';
import { ActorGuard } from './auth/actor.guard';
import { PermissionGuard } from './auth/permission.guard';
import { ClockService } from './clock/clock.service';
import { EnvelopeInterceptor } from './http/envelope.interceptor';
import { ProblemDetailsFilter } from './http/problem-details.filter';

/**
 * The request pipeline every module shares (specs/api-conventions.md,
 * section 6). Global guards run in the order listed: BetterAuth resolves the
 * session (401 without one, unless @AllowAnonymous), ActorGuard builds the
 * Actor, PermissionGuard checks @RequirePermission (403).
 */
@Global()
@Module({
  providers: [
    ClockService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ActorGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
  exports: [ClockService],
})
export class CoreModule {}
