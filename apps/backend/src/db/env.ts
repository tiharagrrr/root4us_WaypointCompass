import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Repo root, resolved from src/db or dist/db. */
export const REPO_ROOT = resolve(__dirname, '../../../..');

/**
 * Loads .env for standalone scripts (migrate, seed, reset). Values already
 * present in the environment (e.g. from Docker Compose) win.
 */
export function loadEnv(): void {
  for (const file of [
    resolve(process.cwd(), '.env'),
    resolve(REPO_ROOT, '.env'),
  ]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

/**
 * Migrations, the seed and demo reset connect as compass_owner through
 * DIRECT_URL (on Supabase, the direct or session URL, never the pooler).
 * Falls back to DATABASE_URL for a single-user local database.
 */
export function ownerUrl(): string {
  return process.env.DIRECT_URL || requireEnv('DATABASE_URL');
}
