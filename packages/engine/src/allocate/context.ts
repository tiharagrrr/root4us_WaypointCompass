import { EngineInputError } from '../errors';
import { resolveParams, type EngineParams } from '../params';
import { buildLookups, type Lookups } from '../plan/measure';
import { planDow } from '../plan/plan-date';
import { effectiveWindow } from '../plan/stops';
import type {
  EngineDistrict,
  EngineInput,
  EngineOrder,
  EngineOutlet,
  FairnessHistory,
  RuleContext,
  Trip,
  Unplanned,
} from '../types';

/** An outlet with no history has never been deferred and was served today, so it scores nothing. */
export const NO_HISTORY: FairnessHistory = {
  deferredOnLastRun: false,
  consecutiveDeferrals: 0,
  daysSinceLastServed: 0,
};

/**
 * What every step of the allocator reads: the input with its params resolved and its tables turned
 * into lookups. Built once per run, never mutated.
 */
export interface AllocContext {
  readonly input: EngineInput;
  readonly params: EngineParams;
  readonly lookups: Lookups;
  readonly planDow: number;
}

export function allocContext(input: EngineInput): AllocContext {
  // The date is refused first, as validate() does, whatever the orders hold.
  const dow = planDow(input.date);
  return { input, params: resolveParams(input.params), lookups: buildLookups(input), planDow: dow };
}

export function orderOf(ctx: AllocContext, orderId: string): EngineOrder {
  const order = ctx.lookups.orderById.get(orderId);
  if (!order) {
    throw new EngineInputError({
      code: 'UNKNOWN_ORDER',
      field: 'allocate.orderIds',
      value: orderId,
      reason: 'is not in input.orders',
    });
  }
  return order;
}

export function outletOf(ctx: AllocContext, order: EngineOrder): EngineOutlet {
  const outlet = ctx.input.outlets[order.outletId];
  if (!outlet) {
    throw new EngineInputError({
      code: 'UNKNOWN_OUTLET',
      field: `input.orders[${JSON.stringify(order.id)}].outletId`,
      value: order.outletId,
      reason: 'is not in input.outlets',
    });
  }
  return outlet;
}

export function districtOf(ctx: AllocContext, districtId: string): EngineDistrict {
  const district = ctx.input.districts[districtId];
  if (!district) {
    throw new EngineInputError({
      code: 'UNKNOWN_DISTRICT',
      field: 'input.orders[].districtId',
      value: districtId,
      reason: 'is not in input.districts',
    });
  }
  return district;
}

export function historyOf(ctx: AllocContext, order: EngineOrder): FairnessHistory {
  return ctx.input.history[order.outletId] ?? NO_HISTORY;
}

/** The effective window of the order's outlet: its own, narrowed by the mall window. */
export function windowOf(ctx: AllocContext, order: EngineOrder): { openMin: number; closeMin: number } {
  return effectiveWindow(outletOf(ctx, order));
}

/**
 * A RuleContext over a candidate plan, so the allocator asks the rules themselves whether a
 * placement is legal instead of repeating their arithmetic.
 */
export function ruleContextOf(
  ctx: AllocContext,
  trips: readonly Trip[],
  unplanned: readonly Unplanned[] = [],
): RuleContext {
  return {
    input: ctx.input,
    params: ctx.params,
    trips,
    unplanned,
    orderById: ctx.lookups.orderById,
    planDow: ctx.planDow,
  };
}
