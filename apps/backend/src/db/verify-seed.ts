/**
 * Says what the database holds after a seed, next to which dataset files SEED_DATA_DIR offers, so
 * a half-seeded database is obvious. Read-only. Exits 1 when the reference data is missing.
 *   pnpm db:verify         (pnpm db:fresh runs reset, migrate, seed, then this)
 */
import { resolve } from 'node:path';
import { eq, isNotNull, sql } from 'drizzle-orm';
import { createDatabase, createPool } from './client';
import { loadEnv, ownerUrl, REPO_ROOT } from './env';
import {
  calendarDays,
  deferralReasons,
  depots,
  devices,
  districts,
  items,
  orders,
  outlets,
  plans,
  roadConditions,
  serviceAllowances,
  trafficSpeeds,
  trips,
  users,
  vehicles,
} from './schema';
import { findSeedFile } from './seed/csv';

/** Every dataset file the seed can read, and what it fills (specs/data/datasets.md, At a glance). */
const FILES: readonly { file: string; loads: string }[] = [
  { file: 'outlets.csv', loads: 'outlets' },
  { file: 'vehicles.csv', loads: 'vehicles' },
  { file: 'calendar.csv', loads: 'calendar_days' },
  { file: 'district_travel.csv', loads: 'districts, depots' },
  { file: 'service_allowance.csv', loads: 'service_allowances' },
  { file: 'traffic_speed.csv', loads: 'traffic_speeds' },
  { file: 'road_conditions.csv', loads: 'road_conditions' },
  {
    file: 'deliveries_train.csv',
    loads: '14 days of history and the Kandy demo day',
  },
  {
    file: 'task2b_peak_day_scenarios.csv',
    loads: 'the S1 demo day at Peliyagoda',
  },
  { file: 'task2b_peak_day_fleet.csv', loads: 'S1 vehicle status' },
];

const pad = (s: string, n: number) => s.padEnd(n);

async function main() {
  loadEnv();
  const dir = process.env.SEED_DATA_DIR
    ? resolve(process.env.SEED_DATA_DIR)
    : resolve(REPO_ROOT, 'data/seed');
  const pool = createPool(ownerUrl());
  try {
    const db = createDatabase(pool);

    console.log(`\nDataset files in ${dir}`);
    const missing: string[] = [];
    for (const { file, loads } of FILES) {
      const found = findSeedFile(dir, file) !== null;
      if (!found) missing.push(file);
      console.log(
        `  ${found ? 'found  ' : 'MISSING'}  ${pad(file, 32)} -> ${loads}`,
      );
    }

    const counts: [string, number][] = [
      ['depots', await db.$count(depots)],
      ['districts', await db.$count(districts)],
      ['outlets', await db.$count(outlets)],
      ['vehicles', await db.$count(vehicles)],
      ['calendar_days', await db.$count(calendarDays)],
      ['service_allowances', await db.$count(serviceAllowances)],
      ['traffic_speeds', await db.$count(trafficSpeeds)],
      ['road_conditions', await db.$count(roadConditions)],
      ['deferral_reasons', await db.$count(deferralReasons)],
      ['items (catalog)', await db.$count(items)],
      ['plans', await db.$count(plans)],
      ['trips', await db.$count(trips)],
      ['orders', await db.$count(orders)],
      ['users', await db.$count(users)],
      [
        '  with a username (personas)',
        await db.$count(users, isNotNull(users.username)),
      ],
      [
        'dock devices',
        await db.$count(devices, eq(devices.isDockDevice, true)),
      ],
    ];
    console.log('\nRows in the database');
    for (const [table, n] of counts)
      console.log(`  ${pad(table, 30)} ${String(n).padStart(7)}`);

    const roles = await db
      .select({ role: users.role, n: sql<number>`count(*)::int` })
      .from(users)
      .groupBy(users.role)
      .orderBy(users.role);
    console.log('\nUsers by role');
    for (const r of roles)
      console.log(`  ${pad(r.role, 30)} ${String(r.n).padStart(7)}`);

    const depotRows = await db
      .select({ id: depots.id, name: depots.name })
      .from(depots);
    console.log(
      `\nDepots: ${depotRows.map((d) => `${d.id} (${d.name})`).join(', ') || 'none'}`,
    );

    if (missing.length)
      console.warn(
        `\n[verify] ${missing.length} dataset file(s) missing; the tables they load stay empty: ${missing.join(', ')}`,
      );
    const personas = counts.find(([t]) => t.includes('personas'))?.[1] ?? 0;
    if (personas === 0)
      console.warn(
        '\n[verify] no persona accounts: set SEED_PASSWORD (10+ characters) in apps/backend/.env and run pnpm db:seed again',
      );
    const reference = counts.slice(0, 5).every(([, n]) => n > 0);
    if (!reference) {
      console.error(
        '\n[verify] reference data is missing: put the booklet files in SEED_DATA_DIR and run pnpm db:seed',
      );
      process.exitCode = 1;
    } else {
      console.log('\n[verify] reference data present');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[verify] failed:', err);
  process.exit(1);
});
