import type { EngineParams } from './params';
import { effectiveWindow } from './plan/window';
import type { EngineInput, EngineOrder } from './types';

const CONSECUTIVE_DEFERRALS_CAP = 3;
const DAYS_SINCE_SERVED_CAP = 10;
const TIGHT_WINDOW_MIN = 120;

/**
 * How much an order matters, for ranking and for choosing what to defer: 40 for a repeat skip, up to
 * 3 x 10 for deferrals in a row, 2 a day since last served up to 10 days, then 15 Fresh, 10 chilled,
 * 8 urgent and 6 for a window under two hours. The maximum is 129. Weights come from params, so the
 * A6 settings can change them. An outlet with no history counts as never deferred.
 */
export function priorityOf(input: EngineInput, order: EngineOrder, params: EngineParams): number {
  const w = params.priorityWeights;
  const history = input.history[order.outletId];
  const outlet = input.outlets[order.outletId];

  let score = 0;
  if (history?.deferredOnLastRun) score += w.deferredOnLastRun;
  score += w.consecutiveDeferrals * Math.min(history?.consecutiveDeferrals ?? 0, CONSECUTIVE_DEFERRALS_CAP);
  score += w.daysSinceLastServed * Math.min(history?.daysSinceLastServed ?? 0, DAYS_SINCE_SERVED_CAP);
  if (order.brand === 'FRESH') score += w.fresh;
  if (order.tempClass === 'CHILLED') score += w.chilled;
  if (order.urgent) score += w.urgent;
  if (outlet) {
    const window = effectiveWindow(outlet);
    if (window.closeMin - window.openMin < TIGHT_WINDOW_MIN) score += w.tightWindow;
  }
  return score;
}
