/**
 * Drops every table in a LOCAL database so `pnpm db:reset` can migrate and
 * seed from scratch. Refuses any host but localhost; never point it at a
 * shared database.
 *   pnpm db:reset   (drop, then db:migrate, then db:seed)
 */
import { createPool } from './client';
import { loadEnv, ownerUrl } from './env';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

async function main() {
  loadEnv();
  const url = ownerUrl();
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`db:reset only runs against localhost, not ${host}`);
  }
  const pool = createPool(url);
  try {
    // compass_owner doesn't own the public schema, so drop what it owns inside it.
    await pool.query(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN SELECT tablename FROM pg_tables
                 WHERE schemaname = 'public' AND tableowner = current_user LOOP
          EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
        END LOOP;
        FOR r IN SELECT sequencename FROM pg_sequences
                 WHERE schemaname = 'public' AND sequenceowner = current_user LOOP
          EXECUTE format('DROP SEQUENCE IF EXISTS public.%I CASCADE', r.sequencename);
        END LOOP;
        FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'public' AND t.typtype = 'e'
                   AND t.typowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) LOOP
          EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
        END LOOP;
      END $$;
      DROP FUNCTION IF EXISTS public.audit_events_immutable() CASCADE;
      DROP SCHEMA IF EXISTS drizzle CASCADE;
    `);
    console.log(`[reset] dropped every table on ${host}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[reset] failed:', err);
  process.exit(1);
});
