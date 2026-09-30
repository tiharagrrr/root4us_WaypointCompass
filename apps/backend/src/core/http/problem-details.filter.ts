import { type ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { TransitionError } from '@waypoint/shared';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { ZodError } from 'zod';
import {
  DomainError,
  type FieldError,
  PayloadTooLargeError,
  StateConflictError,
  ValidationError,
} from '../errors/domain-errors';
import { requestId } from './request-id';

const PROBLEM_BASE = 'https://compass.waypoint.lk/problems/';

export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance: string;
  requestId: string;
  [extension: string]: unknown;
}

/** Codes for errors that are not DomainErrors (Nest's own, guards, body parsing). */
const CODE_BY_STATUS: Record<number, [code: string, title: string]> = {
  400: ['VALIDATION_FAILED', 'Some fields need attention'],
  401: ['UNAUTHENTICATED', 'Sign in to continue'],
  403: ['FORBIDDEN', "You don't have access to this"],
  404: ['NOT_FOUND', 'Not found'],
  409: ['CONFLICT_STATE', 'This conflicts with the current state'],
  412: ['VERSION_MISMATCH', 'Someone else changed this'],
  413: ['PAYLOAD_TOO_LARGE', 'The request is too large'],
  428: ['PRECONDITION_REQUIRED', 'If-Match is required'],
  429: ['RATE_LIMITED', 'Too many requests'],
  500: ['INTERNAL', 'Something went wrong'],
  503: ['DEPENDENCY_UNAVAILABLE', 'A service we depend on is unavailable'],
};

/** Postgres error codes the database raises as the last line of defence. */
const CODE_BY_PG: Record<string, number> = {
  '23505': 409, // unique
  '23503': 409, // foreign key
  '23514': 400, // check
  '42501': 403, // row-level security
};

/**
 * Step 9 of the request lifecycle: renders every error under /api as RFC 9457
 * problem+json with a stable code and the request id, plus the error's
 * headers (Retry-After). Other paths (/health, /metrics) keep Nest's default.
 */
@Catch()
export class ProblemDetailsFilter extends BaseExceptionFilter {
  constructor(private readonly log: PinoLogger) {
    super();
    this.log.setContext('http');
  }

  catch(err: unknown, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<Request>();
    const res = host.switchToHttp().getResponse<Response>();
    if (!req.originalUrl.startsWith('/api/')) return super.catch(err, host);

    const problem = toProblem(err, req);
    if (problem.status >= 500) {
      this.log.error(
        { err, requestId: problem.requestId, event: 'http.request.failed' },
        'unhandled error',
      );
    }
    const domain = asDomainError(err);
    for (const [name, value] of Object.entries(domain?.headers() ?? {}))
      res.setHeader(name, value);
    res.status(problem.status).type('application/problem+json').json(problem);
  }
}

export function toProblem(err: unknown, req: Request): Problem {
  const base = { instance: req.originalUrl, requestId: requestId(req) };
  const domain = asDomainError(err);
  if (domain) {
    return {
      type: typeUrl(domain.code),
      title: domain.title,
      status: domain.status,
      code: domain.code,
      ...(domain.detail && { detail: domain.detail }),
      ...base,
      ...domain.extensions(),
    };
  }

  const pg = pgError(err);
  const status =
    err instanceof HttpException
      ? err.getStatus()
      : (CODE_BY_PG[pg?.code ?? ''] ?? 500);
  const [code, title] =
    CODE_BY_STATUS[status] ?? CODE_BY_STATUS[status >= 500 ? 500 : 400];
  const detail =
    err instanceof HttpException && status < 500
      ? err.message
      : pg?.code === '23514' && pg.constraint
        ? `The value breaks the ${pg.constraint} rule.`
        : undefined;
  return {
    type: typeUrl(code),
    title,
    status,
    code,
    ...(detail && { detail }),
    ...base,
  };
}

/** Errors from outside core/errors that have a domain meaning. */
function asDomainError(err: unknown): DomainError | undefined {
  if (err instanceof DomainError) return err;
  if (err instanceof TransitionError)
    return new StateConflictError(err.message);
  if (err instanceof ZodError) return new ValidationError(zodFieldErrors(err));
  // body-parser's errors (JSON body re-added by BetterAuth's module)
  const type = (err as { type?: unknown } | null)?.type;
  if (type === 'entity.too.large') return new PayloadTooLargeError();
  if (type === 'entity.parse.failed')
    return new ValidationError([
      {
        field: 'body',
        code: 'json',
        message: 'The request body is not valid JSON.',
      },
    ]);
  return undefined;
}

export function zodFieldErrors(err: ZodError): FieldError[] {
  return err.issues.map((issue) => ({
    field: issue.path
      .map((p, i) =>
        typeof p === 'number'
          ? `[${p}]`
          : i === 0
            ? String(p)
            : `.${String(p)}`,
      )
      .join(''),
    code: issue.code,
    message: issue.message,
  }));
}

const typeUrl = (code: string) =>
  PROBLEM_BASE + code.toLowerCase().replaceAll('_', '-');

/** A DrizzleQueryError carries the pg error in `cause`. */
function pgError(
  err: unknown,
): { code: string; constraint?: string } | undefined {
  type PgLike = { code?: unknown; constraint?: unknown };
  const e = err as (PgLike & { cause?: PgLike }) | null;
  const source = typeof e?.cause?.code === 'string' ? e.cause : e;
  if (typeof source?.code !== 'string') return undefined;
  return {
    code: source.code,
    constraint:
      typeof source.constraint === 'string' ? source.constraint : undefined,
  };
}
