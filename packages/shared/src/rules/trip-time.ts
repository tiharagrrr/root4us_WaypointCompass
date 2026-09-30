import type { Brand } from '../domain';

/**
 * Daily time budgets per vehicle (Challenge Booklet, Task 2B).
 * Fresh trips share one window; Style and Tech trips share another.
 */
export const DAILY_TIME_BUDGET_MIN = {
  fresh: 270, // 3:30 AM to 8:00 AM
  styleAndTech: 480, // trading day
} as const;

export type BudgetWindow = keyof typeof DAILY_TIME_BUDGET_MIN;

export function budgetWindowFor(brand: Brand): BudgetWindow {
  return brand === 'FRESH' ? 'fresh' : 'styleAndTech';
}

export interface TripTimeInput {
  /** depot_to_district_freeflow_min for the trip's district, counted once. */
  outboundMin: number;
  /** inter_stop_freeflow_min for the trip's district. */
  interStopMin: number;
  /** service_allowance_min for each stop (brand + outlet dock_type). */
  handlingMin: readonly number[];
}

/**
 * trip_minutes = outbound travel + inter-stop travel + total handling time.
 * The return journey is excluded; the daily budgets already allow for it.
 */
export function tripMinutes({
  outboundMin,
  interStopMin,
  handlingMin,
}: TripTimeInput): number {
  const stops = handlingMin.length;
  if (stops === 0) return 0;
  const handling = handlingMin.reduce((sum, m) => sum + m, 0);
  return outboundMin + interStopMin * (stops - 1) + handling;
}
