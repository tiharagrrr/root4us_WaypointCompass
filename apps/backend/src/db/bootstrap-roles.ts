/**
 * Creates the three Waypoint database roles, as a Node equivalent of
 * deploy/db/roles.sql for platforms with no Postgres init hook.
 *
 * Compose runs roles.sql from deploy/db/init/00-roles.sh when the volume is first created, and CI
 * runs it before db:migrate. Railway has neither, and the API image has no psql, so the same
 * statements run here instead:
 *   railway: node dist/db/bootstrap-roles.js   (before migrate, in the pre-deploy command)
 *
 * Off unless DB_BOOTSTRAP_ROLES is set, because creating a role needs CREATEROLE, which the
 * migration role does not have on a managed Postgres (Supabase, RDS).
 *
 * Idempotent: an existing role keeps its grants and only has its password reset, so it is safe on
 * every deploy. Table grants come from the *_platform_integrity migration, not from here.
 */
import { type PoolClient } from 'pg';
import { createPool } from './client';
import { loadEnv, ownerUrl, requireEnv } from './env';

/** The roles, and the environment variable holding each one's password. */
const ROLES = [
  { name: 'compass_owner', password: 'COMPASS_OWNER_PASSWORD' },
  { name: 'compass_app', password: 'COMPASS_APP_PASSWORD' },
  { name: 'compass_readonly', password: 'COMPASS_READONLY_PASSWORD' },
] as const;

/** True when DB_BOOTSTRAP_ROLES asks for the bootstrap. */
export function bootstrapEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const v = env.DB_BOOTSTRAP_ROLES?.trim().toLowerCase();
  return v === 'true' || v === '1';
}

/**
 * Role names and passwords cannot be bound as query parameters, so Postgres quotes them itself:
 * format('%I') for an identifier, format('%L') for a literal.
 */
async function render(
  client: PoolClient,
  template: string,
  values: readonly string[],
): Promise<string> {
  // The casts are required: format() takes "any", so the parameter types are not inferable.
  const args = values.map((_, i) => `$${i + 2}::text`).join(', ');
  const { rows } = await client.query<{ sql: string }>(
    `select format($1::text${args ? `, ${args}` : ''}) as sql`,
    [template, ...values],
  );
  return rows[0].sql;
}

/** Runs `template` with its values quoted by Postgres. */
async function run(
  client: PoolClient,
  template: string,
  values: readonly string[],
): Promise<void> {
  await client.query(await render(client, template, values));
}

async function exists(client: PoolClient, role: string): Promise<boolean> {
  const { rowCount } = await client.query(
    'select 1 from pg_roles where rolname = $1',
    [role],
  );
  return rowCount === 1;
}

/**
 * Creates any missing role, (re)sets every password and grants database and schema access, the
 * same statements and order as deploy/db/roles.sql. Returns the roles it created.
 */
export async function bootstrapRoles(
  client: PoolClient,
  passwords: Readonly<Record<string, string>>,
): Promise<string[]> {
  const { rows } = await client.query<{ db: string }>(
    'select current_database() as db',
  );
  const db = rows[0].db;
  const created: string[] = [];

  for (const role of ROLES) {
    // An absent password would render as NULL and strip the role's password instead of setting it.
    const password = passwords[role.name];
    if (!password) {
      throw new Error(`[bootstrap-roles] no password given for ${role.name}`);
    }
    if (!(await exists(client, role.name))) {
      await run(client, 'create role %I', [role.name]);
      created.push(role.name);
    }
    await run(client, 'alter role %I login password %L', [role.name, password]);
  }

  // compass_owner creates the tables (public) and the migration journal (drizzle schema).
  await run(client, 'grant connect, create on database %I to %I', [
    db,
    'compass_owner',
  ]);
  await run(client, 'grant usage, create on schema public to %I', [
    'compass_owner',
  ]);
  await run(client, 'grant connect on database %I to %I, %I', [
    db,
    'compass_app',
    'compass_readonly',
  ]);

  return created;
}

async function main(): Promise<void> {
  loadEnv();
  if (!bootstrapEnabled()) {
    console.log('[bootstrap-roles] DB_BOOTSTRAP_ROLES is not set; skipping');
    return;
  }
  const passwords = Object.fromEntries(
    ROLES.map((r) => [r.name, requireEnv(r.password)]),
  );
  // ADMIN_URL first: creating a role needs CREATEROLE, which compass_owner does not have.
  const pool = createPool(process.env.ADMIN_URL || ownerUrl());
  const client = await pool.connect();
  try {
    const created = await bootstrapRoles(client, passwords);
    console.log(
      created.length
        ? `[bootstrap-roles] created ${created.join(', ')}`
        : '[bootstrap-roles] every role already exists',
    );
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[bootstrap-roles] failed:', err);
    process.exit(1);
  });
}
