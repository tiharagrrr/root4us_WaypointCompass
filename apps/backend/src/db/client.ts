import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** A Drizzle transaction handle, as passed to db.transaction(cb). */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10 });
}

/** Column names are the camelCase TypeScript keys, so no casing option. */
export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema });
}
