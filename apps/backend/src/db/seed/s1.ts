import type { TempClass } from '@waypoint/shared';
import { z } from 'zod';
import { amount, field, type Row } from './csv';

/** One S1 order, as task2b_peak_day_scenarios.csv gives it (specs/data/datasets.md, Scenario S1). */
export interface S1Order {
  ref: string;
  outletId: string;
  tempClass: TempClass;
  units: number;
  weightKg: number;
  volumeM3: number;
  /** The outlet was skipped on the run before: it waits as DEFERRED from D−1. */
  deferredYesterday: boolean;
}

export const S1_FILES = {
  orders: 'task2b_peak_day_scenarios.csv',
  fleet: 'task2b_peak_day_fleet.csv',
} as const;

/** Maps by header name, never by position, and fails loudly on a value it cannot read. */
export function parseS1Orders(rows: readonly Row[]): S1Order[] {
  return rows.map((row) => {
    const ref = `S1 ${row.order_ref ?? '?'}`;
    const temp = field(row, 'temp_requirement', ref).toLowerCase();
    if (temp !== 'chilled' && temp !== 'ambient')
      throw new Error(
        `[seed] ${ref}: temp_requirement "${temp}" is not chilled or ambient`,
      );
    const flag = field(row, 'deferred_yesterday', ref);
    if (flag !== '0' && flag !== '1')
      throw new Error(
        `[seed] ${ref}: deferred_yesterday "${flag}" is not 0 or 1`,
      );
    return {
      ref: field(row, 'order_ref', ref),
      outletId: field(row, 'outlet_id', ref),
      tempClass: temp === 'chilled' ? 'CHILLED' : 'AMBIENT',
      units: Math.round(amount(row, 'order_units', ref)),
      weightKg: amount(row, 'order_weight_kg', ref),
      volumeM3: amount(row, 'order_volume_m3', ref),
      deferredYesterday: flag === '1',
    };
  });
}

/**
 * Vehicle availability on the S1 day. `in_workshop` is the one literal the booklet names; any
 * other status counts as available (the exact literal is an open question).
 */
export function parseS1Fleet(rows: readonly Row[]): {
  workshop: string[];
  available: string[];
} {
  const workshop: string[] = [];
  const available: string[] = [];
  for (const row of rows) {
    const id = field(row, 'vehicle_id', 'S1 fleet');
    if ((row.status ?? '').trim().toLowerCase() === 'in_workshop')
      workshop.push(id);
    else available.push(id);
  }
  return { workshop, available };
}

/**
 * What a reset needs to rebuild one depot's demo day without the CSVs, kept in settings as
 * `demo.s1` scoped to the depot (like `demo.clock`, outside the settings registry). Peliyagoda's
 * comes from scenario S1; Kandy's from the last day of deliveries_train.csv.
 */
export const s1SnapshotSchema = z.object({
  v: z.literal(2),
  /** Every order ref on the demo day at this depot; the rebuild puts each back on D. */
  orders: z.array(z.string()),
  /** Refs whose outlet was skipped on the run before D: DEFERRED from D−1. */
  deferredYesterday: z.array(z.string()),
  workshop: z.array(z.string()),
  available: z.array(z.string()),
  /** The outlet that gets a draft dry order for D+1 (Fresh Kadawatha), if it is at this depot. */
  draftOutletId: z.string().nullable(),
});
export type S1Snapshot = z.infer<typeof s1SnapshotSchema>;

export const S1_SETTING = 'demo.s1';
