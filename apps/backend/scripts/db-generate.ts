/**
 * Wraps `drizzle-kit generate` so migrations follow the team's naming rule:
 *
 *   drizzle/YYYYMMDDHHMM_<module>_<change>.sql      (UTC timestamp)
 *
 *   pnpm --filter api db:generate --name=planning_add_trip_notes
 *   pnpm --filter api db:custom   --name=platform_integrity     (empty file for triggers, grants)
 *   pnpm --filter api db:generate                               (no name: fails if the schema changed,
 *                                                                which is CI's drift check)
 *
 * drizzle-kit writes a 14-digit timestamp prefix; this script trims it to minutes,
 * renames the SQL file and snapshot, and rewrites the journal tag to match.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const MODULES = [
  'identity',
  'master-data',
  'fleet',
  'ordering',
  'planning',
  'loading',
  'execution',
  'sync',
  'receipt',
  'alerts',
  'audit',
  'platform',
  'notifications',
  'webhooks',
  'forecasting',
  'simulation',
];

const OUT = resolve(__dirname, '../drizzle');
const JOURNAL = resolve(OUT, 'meta/_journal.json');

interface Journal {
  entries: { idx: number; tag: string; when: number }[];
}

function readJournal(): { raw: string | null; journal: Journal } {
  if (!existsSync(JOURNAL)) return { raw: null, journal: { entries: [] } };
  const raw = readFileSync(JOURNAL, 'utf8');
  return { raw, journal: JSON.parse(raw) as Journal };
}

function parseArgs(argv: string[]) {
  let name: string | undefined;
  let custom = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--custom') custom = true;
    else if (arg.startsWith('--name=')) name = arg.slice('--name='.length);
    else if (arg === '--name') name = argv[++i];
  }
  return { name, custom };
}

function fail(message: string): never {
  console.error(`[db:generate] ${message}`);
  process.exit(1);
}

const { name, custom } = parseArgs(process.argv.slice(2));

if (name !== undefined) {
  const module = MODULES.find((m) => name.startsWith(`${m}_`));
  if (!module || !/^[a-z0-9-]+_[a-z0-9_]+$/.test(name)) {
    fail(
      `--name must be <module>_<change> in snake_case, with module one of: ${MODULES.join(', ')}`,
    );
  }
} else if (custom) {
  fail('db:custom needs --name=<module>_<change>');
}

const before = readJournal();
const result = spawnSync(
  'drizzle-kit',
  ['generate', '--name', name ?? 'unnamed', ...(custom ? ['--custom'] : [])],
  { stdio: 'inherit', cwd: resolve(__dirname, '..'), shell: false },
);
if (result.status !== 0) process.exit(result.status ?? 1);

const after = readJournal();
const added = after.journal.entries.slice(before.journal.entries.length);
if (added.length === 0) process.exit(0); // no schema changes
if (added.length > 1) fail('drizzle-kit added more than one migration');

const entry = added[0];
const oldTag = entry.tag; // 20260930063012_<name>
const oldPrefix = oldTag.split('_')[0];

if (name === undefined) {
  // Roll back: a schema change needs a migration name.
  rmSync(resolve(OUT, `${oldTag}.sql`), { force: true });
  rmSync(resolve(OUT, `meta/${oldPrefix}_snapshot.json`), { force: true });
  if (before.raw === null) rmSync(JOURNAL, { force: true });
  else writeFileSync(JOURNAL, before.raw);
  fail(
    'the schema changed but no migration name was given; rerun with --name=<module>_<change>',
  );
}

// Trim to minutes; bump a minute if another migration already took that one.
const taken = new Set(
  before.journal.entries.map((e) => e.tag.split('_')[0].slice(0, 12)),
);
const t = new Date(
  Date.UTC(
    Number(oldPrefix.slice(0, 4)),
    Number(oldPrefix.slice(4, 6)) - 1,
    Number(oldPrefix.slice(6, 8)),
    Number(oldPrefix.slice(8, 10)),
    Number(oldPrefix.slice(10, 12)),
  ),
);
const stamp = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 12);
let prefix = stamp(t);
while (taken.has(prefix)) {
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  prefix = stamp(t);
}

const newTag = `${prefix}_${name}`;
renameSync(resolve(OUT, `${oldTag}.sql`), resolve(OUT, `${newTag}.sql`));
renameSync(
  resolve(OUT, `meta/${oldPrefix}_snapshot.json`),
  resolve(OUT, `meta/${prefix}_snapshot.json`),
);
entry.tag = newTag;
writeFileSync(JOURNAL, `${JSON.stringify(after.journal, null, 2)}\n`);
console.log(`[db:generate] drizzle/${newTag}.sql`);
