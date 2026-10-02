import { describe, expect, it } from 'vitest';
import { buildInput } from '../../rules/__tests__/fixture';
import { applyEdits } from '../apply-edits';
import { fits, violationKey } from '../fits';
import { capacityScenario, trip, withOrder } from './scenarios';

describe('fits', () => {
  it('fits: an order that fits has no blocking violation, and the result is the trip with it added', () => {
    const { input, plan } = capacityScenario();
    const r = fits(input, plan, 'fx-ord-4', 'REF-07#1');
    expect(r).toEqual({
      fits: true,
      blocking: [],
      warnings: [],
      result: { weightKg: 30, volumeM3: 12, minutes: 100, litres: 10.8 },
    });
  });

  it('fits: an order that does not fit is blocked with the rule, the numbers and the message', () => {
    const { input, plan } = capacityScenario();
    const big = withOrder(input, 'fx-ord-5', { volumeM3: 0.8 });
    const r = fits(big, plan, 'fx-ord-5', 'REF-07#1');
    expect(r.fits).toBe(false);
    expect(r.blocking).toEqual([
      { rule: 'CAP_VOLUME', severity: 'HARD', scope: 'trip', tripKey: 'REF-07#1', vehicleId: 'fx-veh-1', actual: 12.3, limit: 12, message: 'Over volume by 0.3 m³' },
    ]);
    expect(r.result.volumeM3).toBe(12.3);
  });

  it("fits: a dimmed reason equals the violation validate() returns for the same edit", () => {
    const { input, plan } = capacityScenario();
    const big = withOrder(input, 'fx-ord-5', { volumeM3: 0.8 });
    const edit = applyEdits(big, plan, [{ op: 'ASSIGN_ORDER', orderId: 'fx-ord-5', tripKey: 'REF-07#1' }]);
    expect(fits(big, plan, 'fx-ord-5', 'REF-07#1').blocking).toEqual(edit.introduced.filter((v) => v.severity === 'HARD'));
  });

  it('fits: a soft rule is a warning, not a block (LATE_RISK, 10 minutes of slack)', () => {
    const input = buildInput({
      vehicles: [{ id: 'fx-veh-1' }],
      outlets: { 'fx-out-1': { windowCloseMin: 320 } },
      orders: [1, 2, 3].map((n) => ({ id: `fx-ord-${n}`, outletId: 'fx-out-1' })),
    });
    const plan = { trips: [trip('fx-veh-1', 1, ['fx-ord-1', 'fx-ord-2'])], unplanned: [] };
    const r = fits(input, plan, 'fx-ord-3', 'FV1#1');
    expect(r.fits).toBe(true);
    expect(r.blocking).toEqual([]);
    expect(r.warnings.map((w) => [w.rule, w.orderId, w.actual])).toEqual([['LATE_RISK', 'fx-ord-3', 10]]);
  });

  it('fits: a violation already on the trip is not blamed on the order being added', () => {
    const input = buildInput({
      vehicles: [{ id: 'fx-veh-1', temp: 'AMBIENT' }],
      outlets: { 'fx-out-1': {} },
      orders: [
        { id: 'fx-ord-1', outletId: 'fx-out-1', tempClass: 'CHILLED' },
        { id: 'fx-ord-2', outletId: 'fx-out-1' },
      ],
    });
    const plan = { trips: [trip('fx-veh-1', 1, ['fx-ord-1'])], unplanned: [] };
    const r = fits(input, plan, 'fx-ord-2', 'FV1#1');
    expect(r.fits).toBe(true);
    expect(r.blocking).toEqual([]);
  });

  it('fits: the order must be on no trip yet, and the trip must exist', () => {
    const { input, plan } = capacityScenario();
    expect(() => fits(input, plan, 'fx-ord-1', 'REF-03#1')).toThrow(/ORDER_ALREADY_ASSIGNED/);
    expect(() => fits(input, plan, 'fx-ord-4', 'NOPE#1')).toThrow(/UNKNOWN_TRIP/);
  });

  it('fits: violationKey is the same for the same violation and differs when the numbers differ', () => {
    const { input, plan } = capacityScenario();
    const a = applyEdits(input, plan, [{ op: 'MOVE_ORDER', orderId: 'fx-ord-3', tripKey: 'REF-07#1' }]).violations[0];
    const b = applyEdits(input, plan, [{ op: 'MOVE_ORDER', orderId: 'fx-ord-3', tripKey: 'REF-07#1' }]).violations[0];
    if (!a || !b) throw new Error('expected a violation');
    expect(violationKey(a)).toBe(violationKey(b));
    expect(violationKey(a)).not.toBe(violationKey({ ...b, actual: 13 }));
  });
});
