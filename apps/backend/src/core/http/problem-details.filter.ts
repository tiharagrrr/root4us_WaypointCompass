import {
  type ArgumentsHost,
  Catch,
  HttpException,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request, Response } from 'express';
import { DomainError } from '../errors/domain-errors';
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
  413: ['PAYLOAD_TOO_LARGE', 'The request is too large'],
  429: ['RATE_LIMITED', 'Too many requests'],
  500: ['INTERNAL', 'Something went wrong'],
};

/** Postgres error codes the database raises as the last line of defence. */
const CODE_BY_PG: Record<string, number> = {
  '23505': 409, // unique
  '23503': 409, // foreign key
  '23514': 400, // check
  '42501': 403, // row-level security
};

/**
 * Renders every error under /api as RFC 9457 problem+json with a stable code
 * and the request id. Other paths (/health, /metrics) keep Nest's default.
 */
@Catch()
export class ProblemDetailsFilter extends BaseExceptionFilter {
  private readonly log = new Logger('http');

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
    res.status(problem.status).type('application/problem+json').json(problem);
  }
}

export function toProblem(err: unknown, req: Request): Problem {
  const base = { instance: req.originalUrl, requestId: requestId(req) };
  if (err instanceof DomainError) {
    return {
      type: typeUrl(err.code),
      title: err.title,
      status: err.status,
      code: err.code,
      ...(err.detail && { detail: err.detail }),
      ...base,
      ...err.extensions(),
    };
  }

  const status =
    err instanceof HttpException
      ? err.getStatus()
      : (CODE_BY_PG[pgCode(err) ?? ''] ?? 500);
  const [code, title] =
    CODE_BY_STATUS[status] ?? CODE_BY_STATUS[status >= 500 ? 500 : 400];
  const detail =
    err instanceof HttpException && status < 500 ? err.message : undefined;
  return {
    type: typeUrl(code),
    title,
    status,
    code,
    ...(detail && { detail }),
    ...base,
  };
}

const typeUrl = (code: string) =>
  PROBLEM_BASE + code.toLowerCase().replaceAll('_', '-');

/** A DrizzleQueryError carries the pg error in `cause`. */
function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.cause?.code ?? e?.code;
  return typeof code === 'string' ? code : undefined;
}
