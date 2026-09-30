import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Database } from '../../db/client';

export type FilterOp =
  'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'null';

/** Marks a raw filter value that does not parse. */
export const INVALID: unique symbol = Symbol('invalid');

/** One filterable field of a resource: its column, operators and parser. */
export interface FilterSpec {
  column: AnyPgColumn;
  ops: readonly FilterOp[];
  /** The value to compare with, or INVALID. */
  parse: (raw: string) => unknown;
  /** What a valid value looks like, for the 400 message. */
  format: string;
}

/**
 * Everything the generic list and get need to know about a resource: its
 * table, the relational query that supports `with`, and the whitelists of
 * filters, sorts, search and includes (specs/api-conventions.md, section 7).
 */
export interface ResourceSpec<TTable extends PgTable = PgTable> {
  /** Plural resource name, e.g. "orders"; the singular goes in 404 details. */
  name: string;
  /** Singular, e.g. "order"; defaults to name without its final "s". */
  singular?: string;
  table: TTable;
  /** The relational query key, e.g. 'orders' for db.query.orders. */
  queryKey: keyof Database['query'];
  filters: Record<string, FilterSpec>;
  sorts: Record<string, AnyPgColumn>;
  /** "-submittedAt" or "orderNo"; id is always appended as the tiebreaker. */
  defaultSort: string;
  /** Case-insensitive search over the resource's text fields (?q=). */
  search?: (q: string) => SQL | undefined;
  /** include name -> the relational query's `with` fragment. */
  includes?: Record<string, Record<string, unknown>>;
  pagination: 'offset' | 'cursor';
  /** Overrides the default maximum page size (100 offset, 200 cursor). */
  maxLimit?: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COMPARE: readonly FilterOp[] = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'null',
];

/** One of a Postgres enum's values: filter[status]=CONFIRMED,PLANNED. */
export function enumFilter(
  column: AnyPgColumn & { enumValues?: readonly string[] },
  values: readonly string[] = column.enumValues ?? [],
): FilterSpec {
  return {
    column,
    ops: ['eq', 'ne', 'null'],
    parse: (raw) => (values.includes(raw) ? raw : INVALID),
    format: `one of ${values.join(', ')}`,
  };
}

/** Exact text, or case-insensitive `contains`. */
export function textFilter(column: AnyPgColumn): FilterSpec {
  return {
    column,
    ops: ['eq', 'ne', 'contains', 'null'],
    parse: (raw) => (raw.length <= 200 ? raw : INVALID),
    format: 'text of up to 200 characters',
  };
}

export function uuidFilter(column: AnyPgColumn): FilterSpec {
  return {
    column,
    ops: ['eq', 'ne', 'null'],
    parse: (raw) => (UUID.test(raw) ? raw.toLowerCase() : INVALID),
    format: 'a UUID',
  };
}

/** A business date, compared as 'YYYY-MM-DD'. */
export function dateFilter(column: AnyPgColumn): FilterSpec {
  return {
    column,
    ops: COMPARE,
    parse: (raw) =>
      DATE.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`))
        ? raw
        : INVALID,
    format: 'YYYY-MM-DD',
  };
}

/** An instant, given in ISO 8601 with an offset. */
export function instantFilter(column: AnyPgColumn): FilterSpec {
  return {
    column,
    ops: COMPARE,
    parse: (raw) => {
      const at = new Date(raw);
      return INSTANT.test(raw) && !Number.isNaN(at.getTime()) ? at : INVALID;
    },
    format: 'ISO 8601 with an offset, e.g. 2026-10-01T00:00:00+05:30',
  };
}

export function numberFilter(column: AnyPgColumn): FilterSpec {
  return {
    column,
    ops: COMPARE,
    parse: (raw) => {
      const n = raw.trim() === '' ? NaN : Number(raw);
      return Number.isFinite(n) ? n : INVALID;
    },
    format: 'a number',
  };
}

export function booleanFilter(column: AnyPgColumn): FilterSpec {
  return {
    column,
    ops: ['eq', 'null'],
    parse: (raw) => (raw === 'true' ? true : raw === 'false' ? false : INVALID),
    format: 'true or false',
  };
}

/** A LIKE pattern that finds `q` anywhere, with %, _ and \ taken literally. */
export function contains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
