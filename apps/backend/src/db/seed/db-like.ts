import type { Database } from '../client';

/**
 * What the demo-day code needs from a connection: the seed's owner pool, or the API's request
 * transaction when POST /demo/reset runs it. Both expose these query builders.
 */
export type DbLike = Pick<
  Database,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>;
