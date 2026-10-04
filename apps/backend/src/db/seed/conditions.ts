/**
 * traffic_speed.csv and road_conditions.csv (specs/data/datasets.md). The booklet names only
 * `monsoon`, `speed_index` and `disruption_index`; the key columns (district, hour, date) are found
 * by header name from a short list of likely spellings, and the import fails loudly, naming what
 * it looked for, when none fits. Pure parsing: no database here, so the tests use hand-made rows.
 */
import { amount, field, flag, isoDate, slug, toMinutes, type Row } from './csv';

export interface TrafficSpeedRow {
  districtId: string;
  /** 0 to 23. */
  hour: number;
  monsoon: boolean;
  /** 100 = free flow. */
  speedIndex: number;
}

export interface RoadConditionRow {
  /** YYYY-MM-DD. */
  date: string;
  districtId: string;
  /** 100 = clear. */
  disruptionIndex: number;
}

export const CONDITION_FILES = {
  traffic: 'traffic_speed.csv',
  road: 'road_conditions.csv',
} as const;

const DISTRICT_HEADERS = ['district', 'district_name', 'district_id'];
const HOUR_HEADERS = ['hour', 'hour_of_day', 'hod', 'time', 'hour_start'];
const DATE_HEADERS = ['date', 'day', 'condition_date'];

/** The header that names a key column, whatever the file calls it. */
function headerOf(
  rows: readonly Row[],
  candidates: readonly string[],
  what: string,
  file: string,
): string {
  const headers = Object.keys(rows[0] ?? {});
  const found = headers.find((h) =>
    candidates.includes(h.trim().toLowerCase()),
  );
  if (!found)
    throw new Error(
      `[seed] ${file}: no ${what} column; expected one of ${candidates.join(', ')}`,
    );
  return found;
}

/** "5", "05" or "05:00" to an hour 0 to 23. */
function toHour(raw: string, where: string): number {
  const value = raw.includes(':') ? toMinutes(raw) / 60 : Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 23)
    throw new Error(`[seed] ${where}: hour "${raw}" is not 0 to 23`);
  return value;
}

export function parseTrafficSpeeds(
  rows: readonly Row[],
  file: string = CONDITION_FILES.traffic,
): TrafficSpeedRow[] {
  if (rows.length === 0) return [];
  const district = headerOf(rows, DISTRICT_HEADERS, 'district', file);
  const hour = headerOf(rows, HOUR_HEADERS, 'hour', file);
  return rows.map((row, i) => {
    const where = `${file} row ${i + 2}`;
    return {
      districtId: slug(field(row, district, where)),
      hour: toHour(field(row, hour, where), where),
      monsoon: flag(field(row, 'monsoon', where)),
      speedIndex: amount(row, 'speed_index', where),
    };
  });
}

export function parseRoadConditions(
  rows: readonly Row[],
  file: string = CONDITION_FILES.road,
): RoadConditionRow[] {
  if (rows.length === 0) return [];
  const district = headerOf(rows, DISTRICT_HEADERS, 'district', file);
  const date = headerOf(rows, DATE_HEADERS, 'date', file);
  return rows.map((row, i) => {
    const where = `${file} row ${i + 2}`;
    return {
      date: isoDate(row, date, where),
      districtId: slug(field(row, district, where)),
      disruptionIndex: amount(row, 'disruption_index', where),
    };
  });
}

/** Rows whose district the reference data knows, and how many it did not. */
export function knownDistrictsOnly<T extends { districtId: string }>(
  rows: readonly T[],
  known: ReadonlySet<string>,
): { rows: T[]; skipped: number } {
  const kept = rows.filter((r) => known.has(r.districtId));
  return { rows: kept, skipped: rows.length - kept.length };
}
