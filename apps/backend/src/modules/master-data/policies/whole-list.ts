import type { Actor } from '@waypoint/shared';
import type { Collection } from '../../../core/http/envelope.interceptor';
import {
  compact,
  type LinkBuilder,
  type LinkMap,
  type Resource,
} from '../../../core/http/links';

/**
 * A reference list that comes back whole: depots, districts and the calendar
 * are a handful of rows each, so they carry `meta.page` for the envelope's
 * sake but no paging links. Resources that grow (outlets, items) page
 * normally through `LinkBuilder.page`.
 */
export function wholeList<T extends { id: string }, R extends object>(
  links: Pick<LinkBuilder<T, R>, 'one'>,
  rows: T[],
  actor: Actor,
  self: string,
  extra: LinkMap = {},
): Collection<Resource<R>> {
  return {
    items: rows.map((row) => links.one(row, actor)),
    page: { limit: rows.length, offset: 0, total: rows.length },
    links: { self: { href: self }, ...compact(extra) },
  };
}

/** The same for rows with no id and no links of their own (reference tables). */
export function plainList<T>(rows: T[], self: string): Collection<T> {
  return {
    items: rows,
    page: { limit: rows.length, offset: 0, total: rows.length },
    links: { self: { href: self } },
  };
}
