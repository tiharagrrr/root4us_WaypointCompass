/**
 * Stamps the acting user onto the current transaction so row-level security
 * (./rls.ts) can re-check their scope.
 *
 * - One transaction per request: the API kernel's interceptor wraps each
 *   request in `withActor()` (ROO-7 wires it through nestjs-cls), and worker
 *   jobs run with SYSTEM_ACTOR.
 * - set_config(..., true) is transaction-local, so it is safe behind
 *   Supabase's transaction pooler. Never use a session-level SET.
 * - Fail closed: a transaction with no stamp sees an empty app.role and gets
 *   no rows from the protected tables.
 */
import { sql } from 'drizzle-orm';
import type { Database, Transaction } from './client';

export type ActorRole =
  'admin' | 'dispatcher' | 'loader' | 'driver' | 'store_manager' | 'system';

export interface Actor {
  id: string;
  role: ActorRole;
  depotId?: string | null;
  outletId?: string | null;
}

export const SYSTEM_ACTOR: Actor = { id: 'system', role: 'system' };

export async function stampActor(
  db: Database | Transaction,
  actor?: Actor,
): Promise<void> {
  await db.execute(sql`SELECT
    set_config('app.role', ${actor?.role ?? 'anonymous'}, true),
    set_config('app.user_id', ${actor?.id ?? ''}, true),
    set_config('app.depot_id', ${actor?.depotId ?? ''}, true),
    set_config('app.outlet_id', ${actor?.outletId ?? ''}, true)`);
}

/** Runs `work` in one transaction stamped with `actor`. */
export function withActor<T>(
  db: Database,
  actor: Actor,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await stampActor(tx, actor);
    return work(tx);
  });
}
