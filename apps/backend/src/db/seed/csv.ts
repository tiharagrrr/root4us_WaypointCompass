import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';

export type Row = Record<string, string>;

/**
 * The booklet ships its files in folders (specs/data/datasets.md, At a glance); SEED_DATA_DIR may
 * keep them or be flat, so both are tried.
 */
const FOLDERS = ['', 'General Data', 'Training Data', 'Test Data'];

/** A dataset file's rows by header name, or null when SEED_DATA_DIR doesn't have it. */
export function readSeedCsv(dir: string, file: string): Row[] | null {
  for (const folder of FOLDERS) {
    const path = resolve(dir, folder, file);
    if (existsSync(path))
      return parse<Row>(readFileSync(path, 'utf8'), {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      });
  }
  return null;
}

/** A required cell; fails loudly, naming the file and row, when it is blank. */
export function field(row: Row, name: string, where: string): string {
  const value = row[name];
  if (value === undefined || value === '')
    throw new Error(`[seed] ${where}: ${name} is missing`);
  return value;
}

/** A required non-negative number. */
export function amount(row: Row, name: string, where: string): number {
  const raw = field(row, name, where);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`[seed] ${where}: ${name} "${raw}" is not a number`);
  return value;
}

/** "HH:MM" to minutes after midnight. */
export function toMinutes(v: string): number {
  const [h, m] = v.split(':').map(Number);
  return h * 60 + (m ?? 0);
}

/** A strict YYYY-MM-DD date (the booklet doesn't state the format, so anything else fails). */
export function isoDate(row: Row, name: string, where: string): string {
  const raw = field(row, name, where);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw)))
    throw new Error(`[seed] ${where}: ${name} "${raw}" is not YYYY-MM-DD`);
  return raw;
}
