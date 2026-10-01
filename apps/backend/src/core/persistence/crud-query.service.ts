import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, eq, type SQL } from 'drizzle-orm';
import { NotFoundError } from '../errors/domain-errors';
import {
  afterCursor,
  decodeCursor,
  encodeCursor,
  idColumnOf,
  limitOf,
  orderByOf,
  parseSort,
  searchOf,
  sortSignature,
  sortValueOf,
  whereOf,
  withOf,
} from './list-query';
import type { ListQuery, Page } from './page';
import type { ResourceSpec } from './resource-spec';
import type { StampedDrizzleAdapter } from './transactions';

interface FindConfig {
  where?: SQL;
  orderBy?: SQL[];
  limit?: number;
  offset?: number;
  with?: Record<string, unknown>;
}

/** The two relational-query methods the kernel uses, looked up by key. */
interface RelationalFinder<T> {
  findMany(config: FindConfig): Promise<T[]>;
  findFirst(config: FindConfig): Promise<T | undefined>;
}

export const singularOf = (spec: ResourceSpec) =>
  spec.singular ?? spec.name.replace(/s$/, '');

/**
 * The generic list and get every resource shares. It reads in the current
 * transaction, ANDs in the caller's scope (a module's ScopePolicy), and
 * applies only what the ResourceSpec whitelists. Offset pages count with the
 * same filter; cursor pages fetch one extra row to know whether more exist.
 */
@Injectable()
export class CrudQueryService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
  ) {}

  async list<T extends { id: string }>(
    spec: ResourceSpec,
    query: ListQuery,
    scope?: SQL,
  ): Promise<Page<T>> {
    const idColumn = idColumnOf(spec);
    const sort = parseSort(spec, query.sort);
    const where = and(
      scope,
      whereOf(spec, query.filter),
      searchOf(spec, query.q),
    );
    const orderBy = orderByOf(sort, idColumn);
    const limit = limitOf(spec, query.limit);
    const withArg = withOf(spec, query.include);
    const finder = this.finder<T>(spec);

    if (spec.pagination === 'offset') {
      const offset = Math.max(0, Math.trunc(query.offset ?? 0));
      const [items, total] = await Promise.all([
        finder.findMany({ where, orderBy, limit, offset, with: withArg }),
        this.txHost.tx.$count(spec.table, where),
      ]);
      return { items, page: { limit, offset, total } };
    }

    const signature = sortSignature(sort);
    const after = query.cursor
      ? afterCursor(sort[0], idColumn, decodeCursor(query.cursor, signature))
      : undefined;
    const rows = await finder.findMany({
      where: and(where, after),
      orderBy,
      limit: limit + 1,
      with: withArg,
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    const hasMore = rows.length > limit;
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            k: sortValueOf(last, sort[0], spec),
            id: last.id,
            s: signature,
          })
        : null;
    return { items, page: { limit, nextCursor, hasMore } };
  }

  /** One row by id, or 404 when it is missing or outside the scope. */
  async get<T>(
    spec: ResourceSpec,
    id: string,
    scope?: SQL,
    include?: string | string[],
  ): Promise<T> {
    const row = await this.finder<T>(spec).findFirst({
      where: and(eq(idColumnOf(spec), id), scope),
      with: withOf(spec, include),
    });
    if (!row) throw new NotFoundError(singularOf(spec));
    return row;
  }

  // The kernel is the one place with loose typing (the relational query
  // looked up by key); its inputs and outputs stay typed.
  private finder<T>(spec: ResourceSpec): RelationalFinder<T & object> {
    return this.txHost.tx.query[spec.queryKey] as unknown as RelationalFinder<
      T & object
    >;
  }
}
