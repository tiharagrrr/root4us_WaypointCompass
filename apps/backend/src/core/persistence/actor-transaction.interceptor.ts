import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { SSE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Request } from 'express';
import { from, lastValueFrom, type Observable } from 'rxjs';
import type { StampedDrizzleAdapter } from './transactions';

const SKIP_TRANSACTION = 'waypoint:skip-transaction';

/**
 * The route manages its own transactions, such as a long import that
 * commits in batches. Its services' @Transactional() methods still open
 * stamped transactions of their own.
 */
export const SkipTransaction = () => SetMetadata(SKIP_TRANSACTION, true);

/**
 * Step 7 of the request lifecycle: one transaction per /api/v1 request,
 * stamped with the actor for row-level security (StampedDrizzleAdapter).
 * Interceptors run after the guards, so the actor is known by then. The
 * service's @Transactional() joins this transaction, so the write, its audit
 * row, its outbox event and a stored idempotent response commit together,
 * and an error rolls all of them back. SSE streams never hold one open.
 */
@Injectable()
export class ActorTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly reflector: Reflector,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    const handler = ctx.getHandler();
    const skip =
      !req.originalUrl.startsWith('/api/v1') ||
      Reflect.getMetadata(SSE_METADATA, handler) === true ||
      this.reflector.getAllAndOverride<boolean>(SKIP_TRANSACTION, [
        handler,
        ctx.getClass(),
      ]);
    if (skip) return next.handle();

    return from(
      this.txHost.withTransaction(() =>
        lastValueFrom(next.handle(), { defaultValue: undefined }),
      ),
    );
  }
}
