/**
 * The role bootstrap. The gate is a plain unit test; the statements run against a database inside a
 * transaction that is rolled back, so CREATE ROLE and the grants never stay behind (roles are
 * cluster-wide, but creating one is transactional). Needs an admin connection, since altering a
 * role is not something compass_owner may do, so it runs when TEST_ADMIN_URL is set.
 */
import { type PoolClient } from 'pg';
import { createPool } from '../client';
import { bootstrapEnabled, bootstrapRoles } from '../bootstrap-roles';

const PASSWORDS = {
  compass_owner: 'owner-pw-for-tests',
  compass_app: 'app-pw-for-tests',
  compass_readonly: 'readonly-pw-for-tests',
};
const NAMES = Object.keys(PASSWORDS);

describe('bootstrapEnabled', () => {
  it('is off when DB_BOOTSTRAP_ROLES is unset', () => {
    expect(bootstrapEnabled({})).toBe(false);
  });

  it.each(['true', 'TRUE', ' true ', '1'])('is on for %p', (value) => {
    expect(bootstrapEnabled({ DB_BOOTSTRAP_ROLES: value })).toBe(true);
  });

  it.each(['false', '0', '', 'yes'])('is off for %p', (value) => {
    expect(bootstrapEnabled({ DB_BOOTSTRAP_ROLES: value })).toBe(false);
  });
});

const suite = process.env.TEST_ADMIN_URL ? describe : describe.skip;

class Rollback extends Error {}

suite('bootstrapRoles', () => {
  jest.setTimeout(60_000);
  const pool = createPool(process.env.TEST_ADMIN_URL ?? '');
  afterAll(() => pool.end());

  /** Runs `work` on a client whose transaction never commits. */
  async function rolledBack(work: (client: PoolClient) => Promise<void>) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await work(client);
      throw new Rollback();
    } catch (err: unknown) {
      if (!(err instanceof Rollback)) throw err;
    } finally {
      await client.query('rollback');
      client.release();
    }
  }

  it('leaves the three roles present and able to log in', async () => {
    await rolledBack(async (client) => {
      await bootstrapRoles(client, PASSWORDS);

      const { rows } = await client.query<{
        rolname: string;
        rolcanlogin: boolean;
      }>('select rolname, rolcanlogin from pg_roles where rolname = any($1)', [
        NAMES,
      ]);
      expect(rows.map((r) => r.rolname).sort()).toEqual([...NAMES].sort());
      expect(rows.every((r) => r.rolcanlogin)).toBe(true);
    });
  });

  it('is idempotent: a second run creates nothing and does not throw', async () => {
    await rolledBack(async (client) => {
      await bootstrapRoles(client, PASSWORDS);
      await expect(bootstrapRoles(client, PASSWORDS)).resolves.toEqual([]);
    });
  });

  it('grants compass_owner connect and create on the database', async () => {
    await rolledBack(async (client) => {
      await bootstrapRoles(client, PASSWORDS);

      const { rows } = await client.query<{
        connect: boolean;
        create: boolean;
      }>(
        `select has_database_privilege('compass_owner', current_database(), 'connect') as connect,
                has_database_privilege('compass_owner', current_database(), 'create') as create`,
      );
      expect(rows[0]).toEqual({ connect: true, create: true });
    });
  });

  it('refuses to run when a password is missing, rather than clearing it', async () => {
    await rolledBack(async (client) => {
      const partial = {
        compass_owner: PASSWORDS.compass_owner,
        compass_readonly: PASSWORDS.compass_readonly,
      };
      await expect(bootstrapRoles(client, partial)).rejects.toThrow(
        /no password given for compass_app/,
      );
    });
  });

  it('quotes a password containing a quote rather than breaking the statement', async () => {
    await rolledBack(async (client) => {
      await expect(
        bootstrapRoles(client, { ...PASSWORDS, compass_app: "o'brien';--" }),
      ).resolves.toBeDefined();
    });
  });
});
