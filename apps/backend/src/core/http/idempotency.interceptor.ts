import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { eq, sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { idempotencyKeys } from '../../db/schema';
import { ClockService } from '../clock/clock.service';
import {
  IdempotencyInFlightError,
  IdempotencyKeyReusedError,
  ValidationError,
} from '../errors/domain-errors';
import type { StampedDrizzleAdapter } from '../persistence/transactions';

/** Records are kept this long (specs/api-conventions.md, section 10). */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** Advisory-lock namespace for keys, so they never collide with other locks. */
const LOCK_NAMESPACE = 0x1de4;
const KEY = /^[\x21-\x7e]{1,255}$/;

interface StoredResponse {
  result: unknown;
  location?: string;
}

/**
 * @UseIdempotency(): a repeated Idempotency-Key replays the stored response
 * instead of running the action twice (specs/api-conventions.md, section 5).
 *
 * - Same key and request: the stored result, with Idempotent-Replayed: true.
 * - Same key, different request (or user): 422 IDEMPOTENCY_KEY_REUSED.
 * - Same key while the first is still running: 409 with Retry-After: 1.
 *
 * It runs inside the request's transaction: a transaction-scoped advisory
 * lock on the key serialises duplicates, and the response is stored in the
 * same commit as the write, so a failed request stores nothing and can be
 * retried with the same key. Requests without the header run normally.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request & { actor?: Actor }>();
    const key = req.header('idempotency-key');
    if (key === undefined) return next.handle();
    if (!KEY.test(key))
      throw new ValidationError([
        {
          field: 'Idempotency-Key',
          code: 'format',
          message: 'Use 1 to 255 visible ASCII characters, such as a UUID.',
        },
      ]);
    return from(this.handle(ctx, next, key));
  }

  private async handle(
    ctx: ExecutionContext,
    next: CallHandler,
    key: string,
  ): Promise<unknown> {
    if (!this.txHost.isTransactionActive())
      throw new Error('@UseIdempotency() needs the request transaction');
    const req = ctx.switchToHttp().getRequest<Request & { actor?: Actor }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const tx = this.txHost.tx;

    const lock = await tx.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(${LOCK_NAMESPACE}, hashtext(${key})) AS locked`,
    );
    if (!lock.rows[0]?.locked) throw new IdempotencyInFlightError();

    const request = {
      userId: req.actor?.id ?? 'anonymous',
      method: req.method,
      path: req.originalUrl.split('?')[0],
      requestHash: hashBody(req.body),
    };
    const now = this.clock.realNow();
    const [stored] = await tx
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key));

    if (stored && stored.expiresAt > now) {
      if (
        stored.userId !== request.userId ||
        stored.method !== request.method ||
        stored.path !== request.path ||
        stored.requestHash !== request.requestHash
      )
        throw new IdempotencyKeyReusedError();
      const body = stored.responseBody as StoredResponse;
      res.setHeader('Idempotent-Replayed', 'true');
      if (body.location) res.location(body.location);
      return body.result;
    }
    if (stored)
      await tx.delete(idempotencyKeys).where(eq(idempotencyKeys.key, key));

    const result: unknown = await lastValueFrom(next.handle(), {
      defaultValue: undefined,
    });
    const location = res.getHeader('location');
    await tx.insert(idempotencyKeys).values({
      key,
      ...request,
      status: statusOf(ctx, req),
      responseBody: {
        result,
        ...(typeof location === 'string' && { location }),
      } satisfies StoredResponse,
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
    });
    return result;
  }
}

/** The status Nest will send: @HttpCode, else 201 for POST and 200 otherwise. */
function statusOf(ctx: ExecutionContext, req: Request): number {
  const code: unknown = Reflect.getMetadata(
    HTTP_CODE_METADATA,
    ctx.getHandler(),
  );
  if (typeof code === 'number') return code;
  return req.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK;
}

/** SHA-256 of the body as canonical JSON, so key order doesn't matter. */
export function hashBody(body: unknown): string {
  return createHash('sha256')
    .update(canonical(body) ?? '')
    .digest('hex');
}

function canonical(value: unknown): string | undefined {
  if (Array.isArray(value))
    return `[${value.map((v) => canonical(v) ?? 'null').join(',')}]`;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}
