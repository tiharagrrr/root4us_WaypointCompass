import { lte } from '../util/lte';
import { compareText, stableSort } from '../util/stable-sort';
import type { EngineOrder } from '../types';
import { historyOf, windowOf, type AllocContext } from './context';

/** The formula counts at most three deferrals in a row and ten days since the last delivery. */
export const CONSECUTIVE_DEFERRALS_CAP = 3;
export const DAYS_SINCE_LAST_SERVED_CAP = 10;

/**
 * How much the plan wants this order today (specs/engine/rules.md section 5). Fairness first: an
 * outlet deferred on the last run outscores any order that is only fresh and chilled, so the
 * allocator serves it before a repeat skip can happen again.
 */
export function priorityOf(ctx: AllocContext, order: EngineOrder): number {
  const w = ctx.params.priorityWeights;
  const history = historyOf(ctx, order);
  const window = windowOf(ctx, order);
  // "Under" the tight-window minutes is strict: exactly 120 minutes is not tight.
  const tight = !lte(ctx.params.tightWindowMin, window.closeMin - window.openMin);
  return (
    w.deferredOnLastRun * (history.deferredOnLastRun ? 1 : 0) +
    w.consecutiveDeferrals * Math.min(history.consecutiveDeferrals, CONSECUTIVE_DEFERRALS_CAP) +
    w.daysSinceLastServed * Math.min(history.daysSinceLastServed, DAYS_SINCE_LAST_SERVED_CAP) +
    w.fresh * (order.brand === 'FRESH' ? 1 : 0) +
    w.chilled * (order.tempClass === 'CHILLED' ? 1 : 0) +
    w.urgent * (order.urgent ? 1 : 0) +
    w.tightWindow * (tight ? 1 : 0)
  );
}

/** An order with the numbers every later step sorts and reports on. */
export interface RankedOrder {
  order: EngineOrder;
  priority: number;
  /** The effective window, for the tie-break and for the sequencer. */
  openMin: number;
  closeMin: number;
}

/** Priority descending, then earliest effective window close, then order ref. */
export function compareRank(a: RankedOrder, b: RankedOrder): number {
  return b.priority - a.priority || a.closeMin - b.closeMin || compareText(a.order.ref, b.order.ref);
}

export function rankOrders(ctx: AllocContext, orders: readonly EngineOrder[]): RankedOrder[] {
  const ranked = orders.map((order) => {
    const window = windowOf(ctx, order);
    return { order, priority: priorityOf(ctx, order), openMin: window.openMin, closeMin: window.closeMin };
  });
  return stableSort(ranked, compareRank);
}
