import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Links } from '@waypoint/shared';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { map, type Observable } from 'rxjs';
import { ClockService } from '../clock/clock.service';
import type { AppClsStore, Notice } from '../context/request-context';
import type { PageMeta } from '../persistence/page';
import { requestId } from './request-id';

export type { OffsetPage } from '../persistence/page';

export const API_VERSION = '1.0.0';

export interface Meta {
  requestId: string;
  serverTime: string;
  apiVersion: string;
  notices?: Notice[];
}

/** What a list endpoint returns; the interceptor spreads it over data, meta.page and _links. */
export interface Collection<T> {
  items: T[];
  page: PageMeta;
  links: Links;
}

const isCollection = (out: unknown): out is Collection<unknown> =>
  typeof out === 'object' &&
  out !== null &&
  Array.isArray((out as Collection<unknown>).items) &&
  'page' in out;

/**
 * Step 8 of the request lifecycle: wraps every /api/v1 result as
 * { data, meta } (collections also get meta.page and top-level _links), adds
 * meta.notices, and sets ETag for versioned resources. Express answers 304
 * by itself when a GET's If-None-Match matches that ETag.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(
    private readonly clock: ClockService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    if (!req.originalUrl.startsWith('/api/v1')) return next.handle();

    return next.handle().pipe(
      map((out: unknown) => {
        if (out === undefined || res.statusCode === 204) return out;
        const notices = this.cls.isActive() ? this.cls.get('notices') : [];
        const meta: Meta = {
          requestId: requestId(req),
          serverTime: this.clock.toIso(this.clock.now()),
          apiVersion: API_VERSION,
          ...(notices?.length && { notices }),
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
