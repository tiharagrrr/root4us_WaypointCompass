import type { Actor, Link, Links } from '@waypoint/shared';
import type { Request } from 'express';
import type { ClockService } from '../clock/clock.service';
import { isOffsetPage, type Page, type PageMeta } from '../persistence/page';
import type { Collection } from './envelope.interceptor';

/** A resource as the API returns it: its fields plus what the caller may do next. */
export type Resource<T> = T & { _links: Links };

/** Links by relation; `false` (a condition that failed) and null are left out. */
export type LinkMap = Record<string, Link | false | null | undefined>;

export function compact(links: LinkMap): Links {
  return Object.fromEntries(
    Object.entries(links).filter((entry): entry is [string, Link] =>
      Boolean(entry[1]),
    ),
  );
}

/**
 * Builds `_links` for one resource type (specs/api-conventions.md, section
 * 2). An action link appears only when the state machine, the permission, the
 * scope and the time all allow it: build it from the same can*() helper the
 * service checks, so a link never promises what the server would refuse.
 *
 *   @Injectable()
 *   export class OrderLinks extends LinkBuilder<OrderRow> {
 *     constructor(protected readonly clock: ClockService, private readonly rules: OrderRules) { super(); }
 *     protected self(o: OrderRow) { return `/api/v1/orders/${o.id}`; }
 *     protected actions(o: OrderRow, actor: Actor, now: Date) {
 *       return { submit: this.rules.canSubmit(o, actor, now) && { href: `...`, method: 'POST', requires: ['If-Match'] } };
 *     }
 *   }
 */
export abstract class LinkBuilder<
  T extends { id: string },
  R extends object = T,
> {
  protected abstract readonly clock: ClockService;
  protected abstract self(row: T): string;

  /** Related resources and the actions allowed now (return {} for none). */
  protected abstract actions(row: T, actor: Actor, now: Date): LinkMap;

  /** Shapes the row into its response DTO; the row itself by default. */
  protected present(row: T): R {
    return row as unknown as R;
  }

  one(row: T, actor: Actor): Resource<R> {
    const links = {
      self: { href: this.self(row) },
      ...compact(this.actions(row, actor, this.clock.now())),
    };
    return { ...this.present(row), _links: links };
  }

  /** A collection with paging links, plus collection actions such as `create`. */
  page(
    p: Page<T>,
    actor: Actor,
    req: Request,
    extra: LinkMap = {},
  ): Collection<Resource<R>> {
    return {
      items: p.items.map((row) => this.one(row, actor)),
      page: p.page,
      links: { ...pageLinks(req, p.page), ...compact(extra) },
    };
  }
}

/**
 * self, first, prev, next and last for an offset page; self, first and next
 * for a cursor page. Each keeps the request's filters, sort and search.
 */
export function pageLinks(req: Request, page: PageMeta): Links {
  const at = (params: Record<string, string | undefined>): Link => ({
    href: withParams(req.originalUrl, params),
  });
  const limit = String(page.limit);

  if (isOffsetPage(page)) {
    const { offset, total } = page;
    const lastOffset =
      total > 0 ? Math.floor((total - 1) / page.limit) * page.limit : 0;
    return compact({
      self: at({ limit, offset: String(offset) }),
      first: at({ limit, offset: '0' }),
      prev:
        offset > 0 &&
        at({ limit, offset: String(Math.max(0, offset - page.limit)) }),
      next:
        offset + page.limit < total &&
        at({ limit, offset: String(offset + page.limit) }),
      last: at({ limit, offset: String(lastOffset) }),
    });
  }
  return compact({
    self: at({}),
    first: at({ limit, cursor: undefined }),
    next: page.nextCursor ? at({ limit, cursor: page.nextCursor }) : false,
  });
}

/** The URL with some query parameters set or removed, brackets left readable. */
function withParams(
  originalUrl: string,
  params: Record<string, string | undefined>,
): string {
  const url = new URL(originalUrl, 'http://api.local');
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  const query = url.searchParams
    .toString()
    .replaceAll('%5B', '[')
    .replaceAll('%5D', ']')
    .replaceAll('%2C', ',');
  return query ? `${url.pathname}?${query}` : url.pathname;
}
