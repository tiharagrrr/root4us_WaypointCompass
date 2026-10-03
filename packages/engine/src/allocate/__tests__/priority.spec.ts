import { describe, expect, it } from 'vitest';
import { allocContext } from '../context';
import { priorityOf, rankOrders } from '../priority';
import type { EngineInput, EngineOrder } from '../../types';
import { scenario } from './fixture';

const scoreOf = (input: EngineInput, order: EngineOrder | undefined) => {
  if (!order) throw new Error('the scenario has no such order');
  return priorityOf(allocContext(input), order);
};

describe('priority', () => {
  it('priority: the score adds the weights of the formula and tops out at 129', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1', temp: 'REEFER' }],
      // A window of 60 minutes is under the 120 that counts as tight.
      outlets: { 'fx-out-1': { windowOpenMin: 300, windowCloseMin: 360 } },
      orders: [{ id: 'fx-ord-1', tempClass: 'CHILLED', urgent: true }],
      history: {
        'fx-out-1': { deferredOnLastRun: true, consecutiveDeferrals: 3, daysSinceLastServed: 10 },
      },
    });
    // 40 deferred + 3 × 10 in a row + 10 × 2 days + 15 Fresh + 10 chilled + 8 urgent + 6 tight window.
    expect(scoreOf(input, input.orders[0])).toBe(129);
  });

  it('priority: an outlet with no history and no urgency scores its brand and class only', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1' }],
      orders: [{ id: 'fx-ord-1' }, { id: 'fx-ord-2', brand: 'TECH' }],
    });
    expect(scoreOf(input, input.orders[0])).toBe(15);
    expect(scoreOf(input, input.orders[1])).toBe(0);
  });

  it('priority: deferrals in a row count to three and days since last served to ten', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1' }],
      orders: [{ id: 'fx-ord-1', brand: 'TECH' }],
      history: {
        'fx-out-1': { deferredOnLastRun: true, consecutiveDeferrals: 9, daysSinceLastServed: 40 },
      },
    });
    // 40 + 3 × 10 + 10 × 2, not 40 + 9 × 10 + 40 × 2.
    expect(scoreOf(input, input.orders[0])).toBe(90);
  });

  it('priority: a window of exactly 120 minutes is not tight', () => {
    const atLimit = scenario({
      vehicles: [{ id: 'fx-veh-1' }],
      outlets: { 'fx-out-1': { windowOpenMin: 300, windowCloseMin: 420 } },
      orders: [{ id: 'fx-ord-1', brand: 'TECH' }],
    });
    const under = scenario({
      vehicles: [{ id: 'fx-veh-1' }],
      outlets: { 'fx-out-1': { windowOpenMin: 300, windowCloseMin: 419 } },
      orders: [{ id: 'fx-ord-1', brand: 'TECH' }],
    });
    expect(scoreOf(atLimit, atLimit.orders[0])).toBe(0);
    expect(scoreOf(under, under.orders[0])).toBe(6);
  });

  it('priority: a repeat skip outranks an order that is only fresh and chilled', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1', temp: 'REEFER' }],
      outlets: { 'fx-out-1': {}, 'fx-out-2': {} },
      orders: [
        { id: 'fx-ord-1', outletId: 'fx-out-1', brand: 'TECH' },
        { id: 'fx-ord-2', outletId: 'fx-out-2', tempClass: 'CHILLED' },
      ],
      history: {
        'fx-out-1': { deferredOnLastRun: true, consecutiveDeferrals: 1, daysSinceLastServed: 0 },
      },
    });
    expect(scoreOf(input, input.orders[0])).toBe(50);
    expect(scoreOf(input, input.orders[1])).toBe(25);
  });

  it('priority: equal scores break on the earliest window close, then the order ref', () => {
    const input = scenario({
      vehicles: [{ id: 'fx-veh-1' }],
      outlets: {
        'fx-out-1': { windowCloseMin: 600 },
        'fx-out-2': { windowCloseMin: 400 },
        'fx-out-3': { windowCloseMin: 600 },
      },
      orders: [
        { id: 'fx-ord-2', outletId: 'fx-out-3' },
        { id: 'fx-ord-1', outletId: 'fx-out-1' },
        { id: 'fx-ord-3', outletId: 'fx-out-2' },
      ],
    });
    const ctx = allocContext(input);
    expect(rankOrders(ctx, input.orders).map((entry) => entry.order.id)).toEqual([
      'fx-ord-3',
      'fx-ord-1',
      'fx-ord-2',
    ]);
  });
});
