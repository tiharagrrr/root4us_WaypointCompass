import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Links } from '@waypoint/shared';
import type { Request, Response } from 'express';
import { map, type Observable } from 'rxjs';
import { ClockService } from '../clock/clock.service';
import { requestId } from './request-id';

export const API_VERSION = '1.0.0';

export interface Meta {
  requestId: string;
  serverTime: string;
  apiVersion: string;
}

export interface OffsetPage {
  limit: number;
  offset: number;
  total: number;
}

/** What a list endpoint returns; the interceptor spreads it over data, meta.page and _links. */
export interface Collection<T> {
  items: T[];
  page: OffsetPage;
  links: Links;
}

const isCollection = (out: unknown): out is Collection<unknown> =>
  typeof out === 'object' &&
  out !== null &&
  Array.isArray((out as Collection<unknown>).items) &&
  'page' in out;

/**
 * Wraps every /api/v1 result as { data, meta } (collections also get
 * meta.page and top-level _links) and sets ETag for versioned resources.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly clock: ClockService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    if (!req.originalUrl.startsWith('/api/v1')) return next.handle();

    return next.handle().pipe(
      map((out: unknown) => {
        if (out === undefined || res.statusCode === 204) return out;
        const meta: Meta = {
          requestId: requestId(req),
          serverTime: this.clock.toIso(this.clock.now()),
          apiVersion: API_VERSION,
        };
        if (isCollection(out)) {
          return {
            data: out.items,
            meta: { ...meta, page: out.page },
            _links: out.links,
          };
        }
        const version =
          typeof out === 'object' && out !== null && 'version' in out
            ? out.version
            : undefined;
        if (typeof version === 'number')
          res.setHeader('ETag', `W/"${version}"`);
        return { data: out, meta };
      }),
    );
  }
}
