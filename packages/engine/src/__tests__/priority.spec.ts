import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, resolveParams } from '../params';
import { priorityOf } from '../priority';
import { buildInput } from '../rules/__tests__/fixture';

const FRESH_CHILLED = { tempClass: 'CHILLED', brand: 'FRESH' };

function setup(order: Record<string, unknown>, outlet: Record<string, unknown> = {}, history?: Record<string, number | boolean>) {
  const input = buildInput({
    vehicles: [{ id: 'fx-veh-1' }],
    outlets: { 'fx-out-1': outlet },
    orders: [{ id: 'fx-ord-1', outletId: 'fx-out-1', ...order }],
    ...(history ? { history: { 'fx-out-1': history } } : {}),
  });
  const o = input.orders[0];
  if (!o) throw new Error('no order');
  return { input, order: o };
}

describe('priority', () => {
  it('priority: the default weights add up to 129 at their maximum', () => {
    const { input, order } = setup(
      { ...FRESH_CHILLED, urgent: true },
      { windowOpenMin: 300, windowCloseMin: 360 },
      { deferredOnLastRun: true, consecutiveDeferrals: 3, daysSinceLastServed: 10 },
    );
    expect(priorityOf(input, order, DEFAULT_PARAMS)).toBe(129);
  });

  it('priority: an order with nothing going for it scores 0', () => {
    const { input, order } = setup({ brand: 'STYLE' });
    expect(priorityOf(input, order, DEFAULT_PARAMS)).toBe(0);
  });

  it('priority: a repeat skip (40) outranks an order that is only fresh and chilled (25)', () => {
    const skip = setup({ brand: 'STYLE' }, {}, { deferredOnLastRun: true, consecutiveDeferrals: 0, daysSinceLastServed: 0 });
    const fresh = setup(FRESH_CHILLED);
    expect(priorityOf(skip.input, skip.order, DEFAULT_PARAMS)).toBe(40);
    expect(priorityOf(fresh.input, fresh.order, DEFAULT_PARAMS)).toBe(25);
  });

  it('priority: consecutive deferrals cap at 3 and days since last served cap at 10', () => {
    const a = setup({ brand: 'STYLE' }, {}, { deferredOnLastRun: false, consecutiveDeferrals: 99, daysSinceLastServed: 99 });
    expect(priorityOf(a.input, a.order, DEFAULT_PARAMS)).toBe(10 * 3 + 2 * 10);
    const b = setup({ brand: 'STYLE' }, {}, { deferredOnLastRun: false, consecutiveDeferrals: 2, daysSinceLastServed: 4 });
    expect(priorityOf(b.input, b.order, DEFAULT_PARAMS)).toBe(10 * 2 + 2 * 4);
  });

  it('priority: a window under 120 minutes adds 6, and exactly 120 does not', () => {
    const tight = setup({ brand: 'STYLE' }, { windowOpenMin: 300, windowCloseMin: 419 });
    const exact = setup({ brand: 'STYLE' }, { windowOpenMin: 300, windowCloseMin: 420 });
    expect(priorityOf(tight.input, tight.order, DEFAULT_PARAMS)).toBe(6);
    expect(priorityOf(exact.input, exact.order, DEFAULT_PARAMS)).toBe(0);
  });

  it('priority: at a mall-dock outlet the mall window narrows the window', () => {
    const { input, order } = setup(
      { brand: 'STYLE' },
      { parkingConstraint: 'MALL_DOCK', dockType: 'MALL_BAY', windowOpenMin: 0, windowCloseMin: 1440, mallWindowOpenMin: 300, mallWindowCloseMin: 400 },
    );
    expect(priorityOf(input, order, DEFAULT_PARAMS)).toBe(6);
  });

  it('priority: an outlet with no history counts as never deferred', () => {
    const { input, order } = setup({ brand: 'STYLE' });
    expect(input.history['fx-out-1']).toBeUndefined();
    expect(priorityOf(input, order, DEFAULT_PARAMS)).toBe(0);
  });

  it('priority: the weights come from params and can be overridden, and must not be negative', () => {
    const { input, order } = setup(FRESH_CHILLED);
    const params = resolveParams({ priorityWeights: { ...DEFAULT_PARAMS.priorityWeights, fresh: 100 } });
    expect(priorityOf(input, order, params)).toBe(110);
    expect(() => resolveParams({ priorityWeights: { ...DEFAULT_PARAMS.priorityWeights, urgent: -1 } })).toThrow();
  });
});
