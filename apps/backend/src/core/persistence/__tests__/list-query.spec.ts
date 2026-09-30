import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { vehicles } from '../../../db/schema';
import { ValidationError } from '../../errors/domain-errors';
import {
  afterCursor,
  decodeCursor,
  encodeCursor,
  limitOf,
  orderByOf,
  parseSort,
  sortSignature,
  whereOf,
  withOf,
} from '../list-query';
import {
  contains,
  dateFilter,
  enumFilter,
  numberFilter,
  type ResourceSpec,
  textFilter,
} from '../resource-spec';

const TABLE = {
  name: 'vehicles',
  table: vehicles,
  queryKey: 'vehicles',
  pagination: 'offset',
  defaultSort: 'code',
  filters: {
    status: enumFilter(vehicles.status),
    code: textFilter(vehicles.code),
    weightCapKg: numberFilter(vehicles.weightCapKg),
    // No date column on vehicles; any column does for rendering.
    since: dateFilter(vehicles.code),
  },
  sorts: {
    code: vehicles.code,
    weightCapKg: vehicles.weightCapKg,
    createdAt: vehicles.createdAt,
  },
  includes: { depot: { depot: true } },
} satisfies ResourceSpec<typeof vehicles>;

const FEED = {
  ...TABLE,
  pagination: 'cursor',
  defaultSort: '-createdAt',
} satisfies ResourceSpec<typeof vehicles>;

const dialect = new PgDialect();
const render = (fragment: SQL | undefined) =>
  fragment ? dialect.sqlToQuery(fragment) : undefined;

function fieldErrors(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    if (err instanceof ValidationError)
      return err.errors.map((e) => `${e.field}:${e.code}`);
    throw err;
  }
  throw new Error('expected a ValidationError');
}

describe('list queries', () => {
  it('reads filter[field]=a,b as any of, and filter[field][op] as that operator', () => {
    const where = render(
      whereOf(TABLE, {
        status: 'ACTIVE,WORKSHOP',
        weightCapKg: { gte: '1000', lt: '5000' },
        code: { contains: '50%_off' },
      }),
    );
    expect(where?.sql).toBe(
      '("vehicles"."status" in ($1, $2) and "vehicles"."weightCapKg" >= $3 and "vehicles"."weightCapKg" < $4 and "vehicles"."code" ilike $5)',
    );
    expect(where?.params).toEqual([
      'ACTIVE',
      'WORKSHOP',
      1000,
      5000,
      '%50\\%\\_off%',
    ]);
  });

  it('reads filter[field][null] as is or is not null', () => {
    expect(render(whereOf(TABLE, { code: { null: 'true' } }))?.sql).toBe(
      '"vehicles"."code" is null',
    );
    expect(render(whereOf(TABLE, { code: { null: 'false' } }))?.sql).toBe(
      '"vehicles"."code" is not null',
    );
  });

  it('refuses a filter, operator or value off the whitelist, naming each', () => {
    expect(
      fieldErrors(() =>
        whereOf(TABLE, {
          colour: 'red',
          status: 'PARKED',
          code: { gt: 'A' },
          weightCapKg: { gte: 'heavy' },
          since: { eq: '2026-13-45' },
        }),
      ),
    ).toEqual([
      'filter[colour]:unknown_filter',
      'filter[status]:format',
      'filter[code][gt]:unknown_operator',
      'filter[weightCapKg][gte]:format',
      'filter[since][eq]:format',
    ]);
  });

  it('sorts by the whitelist and always breaks ties by id', () => {
    const keys = parseSort(TABLE, '-weightCapKg,code');
    expect(sortSignature(keys)).toBe('-weightCapKg,code');
    const order = orderByOf(keys, vehicles.id).map((o) => render(o)?.sql);
    expect(order).toEqual([
      '"vehicles"."weightCapKg" desc',
      '"vehicles"."code" asc',
      '"vehicles"."id" desc',
    ]);
    expect(fieldErrors(() => parseSort(TABLE, 'colour'))).toEqual([
      'sort:unknown_sort',
    ]);
    expect(fieldErrors(() => parseSort(FEED, 'code,weightCapKg'))).toEqual([
      'sort:single_sort',
    ]);
  });

  it('compares feed instants to the millisecond, the precision of a cursor', () => {
    const [key] = parseSort(FEED, undefined);
    expect(render(orderByOf([key], vehicles.id)[0])?.sql).toBe(
      `date_trunc('milliseconds', "vehicles"."createdAt") desc`,
    );
    const after = render(
      afterCursor(key, vehicles.id, {
        k: '2026-10-01T09:30:00.123Z',
        id: 'VEH001',
        s: '-createdAt',
      }),
    );
    expect(after?.sql).toBe(
      `(date_trunc('milliseconds', "vehicles"."createdAt"), "vehicles"."id") < ($1, $2)`,
    );
    expect(after?.params).toEqual(['2026-10-01T09:30:00.123Z', 'VEH001']);
  });

  it('round-trips a cursor and refuses a tampered or foreign one', () => {
    const cursor = {
      k: '2026-10-01T09:30:00.123Z',
      id: 'VEH001',
      s: '-createdAt',
    };
    expect(decodeCursor(encodeCursor(cursor), '-createdAt')).toEqual(cursor);
    expect(
      fieldErrors(() => decodeCursor(encodeCursor(cursor), 'code')),
    ).toEqual(['cursor:invalid']);
    expect(fieldErrors(() => decodeCursor('not-a-cursor', 'code'))).toEqual([
      'cursor:invalid',
    ]);
    const forged = Buffer.from('{"k":{"$gt":""},"id":"x","s":"code"}').toString(
      'base64url',
    );
    expect(fieldErrors(() => decodeCursor(forged, 'code'))).toEqual([
      'cursor:invalid',
    ]);
  });

  it('defaults and caps the page size per kind', () => {
    expect(limitOf(TABLE)).toBe(10);
    expect(limitOf(TABLE, 500)).toBe(100);
    expect(limitOf(FEED)).toBe(50);
    expect(limitOf(FEED, 500)).toBe(200);
    expect(limitOf({ ...TABLE, maxLimit: 25 }, 40)).toBe(25);
  });

  it('includes only whitelisted relations', () => {
    expect(withOf(TABLE, 'depot')).toEqual({ depot: true });
    expect(withOf(TABLE, undefined)).toBeUndefined();
    expect(fieldErrors(() => withOf(TABLE, 'depot,trips'))).toEqual([
      'include:unknown_include',
    ]);
  });

  it('escapes LIKE wildcards in search text', () => {
    expect(contains('a%b_c\\d')).toBe('%a\\%b\\_c\\\\d%');
  });
});
