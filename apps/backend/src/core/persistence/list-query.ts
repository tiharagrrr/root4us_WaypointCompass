import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { type FieldError, ValidationError } from '../errors/domain-errors';
import { PAGE_LIMITS } from './page';
import {
  contains,
  type FilterOp,
  type FilterSpec,
  INVALID,
  type ResourceSpec,
} from './resource-spec';

/**
 * Turns a list query into SQL against a resource's whitelists. Anything not
 * on a whitelist answers 400 VALIDATION_FAILED naming the parameter, so a
 * typo never silently returns every row.
 */

export interface SortKey {
  field: string;
  column: AnyPgColumn;
  /** What ORDER BY and the cursor compare: the column, or for a feed on an
   *  instant the column to the millisecond, the precision a cursor carries. */
  expr: AnyPgColumn | SQL;
  dir: 'asc' | 'desc';
}

/** A cursor names the last row's sort value and id, and the sort it came from. */
export interface Cursor {
  k: string | number | boolean | null;
  id: string;
  s: string;
}

const invalid = (field: string, code: string, message: string) =>
  new ValidationError([{ field, code, message }]);

export function idColumnOf(spec: ResourceSpec): AnyPgColumn {
  const id = getTableColumns(spec.table).id as AnyPgColumn | undefined;
  if (!id) throw new Error(`ResourceSpec ${spec.name}: the table has no id`);
  return id;
}

export function parseSort(spec: ResourceSpec, raw?: string): SortKey[] {
  const text = raw?.trim() || spec.defaultSort;
  const keys = text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): SortKey => {
      const field = part.replace(/^[-+]/, '');
      const column = spec.sorts[field];
      if (!column)
        throw invalid(
          'sort',
          'unknown_sort',
          `Sort by one of: ${Object.keys(spec.sorts).join(', ')}.`,
        );
      const expr =
        spec.pagination === 'cursor' && column.dataType === 'date'
          ? sql`date_trunc('milliseconds', ${column})`
          : column;
      return {
        field,
        column,
        expr,
        dir: part.startsWith('-') ? 'desc' : 'asc',
      };
    });
  if (spec.pagination === 'cursor' && keys.length > 1)
    throw invalid('sort', 'single_sort', 'A feed sorts by one field.');
  return keys;
}

/** The sort as text, e.g. "-createdAt", which a cursor must match. */
export const sortSignature = (keys: SortKey[]) =>
  keys.map((k) => `${k.dir === 'desc' ? '-' : ''}${k.field}`).join(',');

/** ORDER BY the sort keys, then id in the primary key's direction. */
export function orderByOf(keys: SortKey[], idColumn: AnyPgColumn): SQL[] {
  const by = (dir: SortKey['dir']) => (dir === 'asc' ? asc : desc);
  return [
    ...keys.map((k) => by(k.dir)(k.expr)),
    by(keys[0]?.dir ?? 'asc')(idColumn),
  ];
}

export function limitOf(spec: ResourceSpec, limit?: number): number {
  const d = PAGE_LIMITS[spec.pagination];
  const max = spec.maxLimit ?? d.max;
  if (limit === undefined) return Math.min(d.default, max);
  return Math.max(1, Math.min(Math.trunc(limit), max));
}

export function withOf(
  spec: ResourceSpec,
  include?: string | string[],
): Record<string, unknown> | undefined {
  const names = (Array.isArray(include) ? include.join(',') : (include ?? ''))
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  if (names.length === 0) return undefined;
  const unknown = names.filter((n) => !spec.includes?.[n]);
  if (unknown.length)
    throw invalid(
      'include',
      'unknown_include',
      `Include one of: ${Object.keys(spec.includes ?? {}).join(', ') || 'nothing'}.`,
    );
  const merged: Record<string, unknown> = {};
  for (const name of names) Object.assign(merged, spec.includes![name]);
  return merged;
}

export function searchOf(spec: ResourceSpec, q?: string): SQL | undefined {
  const text = q?.trim();
  if (!text) return undefined;
  if (!spec.search)
    throw invalid('q', 'not_supported', `${spec.name} can't be searched.`);
  return spec.search(text);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** filter[field]=a,b (any of) and filter[field][op]=value, all ANDed. */
export function whereOf(spec: ResourceSpec, filter: unknown): SQL | undefined {
  if (filter === undefined || filter === '') return undefined;
  if (!isRecord(filter))
    throw invalid('filter', 'format', 'Use filter[field]=value.');

  const errors: FieldError[] = [];
  const parts: SQL[] = [];
  for (const [field, value] of Object.entries(filter)) {
    const filterSpec = spec.filters[field];
    if (!filterSpec) {
      errors.push({
        field: `filter[${field}]`,
        code: 'unknown_filter',
        message: `Filter by one of: ${Object.keys(spec.filters).join(', ')}.`,
      });
      continue;
    }
    const entries: [string, unknown][] = isRecord(value)
      ? Object.entries(value)
      : [['eq', value]];
    for (const [op, raw] of entries) {
      const name = isRecord(value)
        ? `filter[${field}][${op}]`
        : `filter[${field}]`;
      if (!filterSpec.ops.includes(op as FilterOp)) {
        errors.push({
          field: name,
          code: 'unknown_operator',
          message: `Use one of: ${filterSpec.ops.join(', ')}.`,
        });
        continue;
      }
      const text = Array.isArray(raw) ? raw.join(',') : raw;
      const condition =
        typeof text === 'string'
          ? conditionOf(filterSpec, op as FilterOp, text)
          : undefined;
      if (condition) parts.push(condition);
      else
        errors.push({
          field: name,
          code: 'format',
          message:
            op === 'null' ? 'Use true or false.' : `Use ${filterSpec.format}.`,
        });
    }
  }
  if (errors.length) throw new ValidationError(errors);
  return parts.length ? and(...parts) : undefined;
}

function conditionOf(
  f: FilterSpec,
  op: FilterOp,
  text: string,
): SQL | undefined {
  const col = f.column;
  if (op === 'null') {
    if (text === 'true') return isNull(col);
    if (text === 'false') return isNotNull(col);
    return undefined;
  }
  if (op === 'eq' || op === 'ne') {
    const values = text.split(',').map((v) => f.parse(v.trim()));
    if (values.length === 0 || values.includes(INVALID)) return undefined;
    if (values.length === 1)
      return op === 'eq' ? eq(col, values[0]) : ne(col, values[0]);
    return op === 'eq' ? inArray(col, values) : notInArray(col, values);
  }
  const value = f.parse(text);
  if (value === INVALID) return undefined;
  switch (op) {
    case 'contains':
      return ilike(col, contains(String(value)));
    case 'gt':
      return gt(col, value);
    case 'gte':
      return gte(col, value);
    case 'lt':
      return lt(col, value);
    case 'lte':
      return lte(col, value);
  }
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** Checks a cursor's shape and that it came from the same sort; 400 otherwise. */
export function decodeCursor(raw: string, sort: string): Cursor {
  const bad = invalid(
    'cursor',
    'invalid',
    'This cursor is not valid here. Start again from the first page.',
  );
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw bad;
  }
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.s !== sort ||
    !(
      value.k === null ||
      ['string', 'number', 'boolean'].includes(typeof value.k)
    )
  )
    throw bad;
  return value as unknown as Cursor;
}

/** Rows after the cursor in the sort's direction: (sort value, id) past the last row's. */
export function afterCursor(
  key: SortKey,
  idColumn: AnyPgColumn,
  cursor: Cursor,
): SQL {
  const k =
    key.column.dataType === 'date' && typeof cursor.k === 'string'
      ? new Date(cursor.k)
      : cursor.k;
  const past = key.dir === 'asc' ? sql`>` : sql`<`;
  return sql`(${key.expr}, ${idColumn}) ${past} (${sql.param(k, key.column)}, ${sql.param(cursor.id, idColumn)})`;
}

/** The value of the sort column on a row returned by the relational query. */
export function sortValueOf(
  row: Record<string, unknown>,
  key: SortKey,
  spec: ResourceSpec,
): Cursor['k'] {
  const prop = Object.entries(getTableColumns(spec.table)).find(
    ([, column]) => column === key.column,
  )?.[0];
  const value = prop ? row[prop] : undefined;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return value;
  return null;
}
