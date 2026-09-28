import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Repo root, resolved from src/database or dist/database. */
export const REPO_ROOT = resolve(__dirname, '../../../..');

/**
 * Loads .env for standalone scripts (migrate, seed). Values already present
 * in the environment (e.g. from Docker Compose) win.
 */
export function loadEnv(): void {
  for (const file of [resolve(process.cwd(), '.env'), resolve(REPO_ROOT, '.env')]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
