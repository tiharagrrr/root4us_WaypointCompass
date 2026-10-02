import { describe, expect, it } from 'vitest';
import { readFixture, buildInput } from '../../rules/__tests__/fixture';
import { validate } from '../../validate';
import { applyEdits } from '../apply-edits';
import { violationKey } from '../fits';
import { suggestFixes, type FixKind } from '../suggest-fixes';
import { capacityScenario, deepFreeze, trip, withOrder } from './scenarios';

/** AC-PLN-02's plan after the move that overfills REF-07 trip 1. */
function overfull() {
  const { input, plan } = capacityScenario();
  const moved = applyEdits(input, plan, [{ op: 'MOVE_ORDER', orderId: 'fx-ord-3', tripKey: 'REF-07#1' }]);
  const violation = moved.violations[0];
  if (!violation) throw new Error('expected a violation');
  return { input, plan: moved.plan, violation };
}

const kinds = (s: { kind: FixKind }[]) => s.map((x) => x.kind);

describe('suggestFixes', () => {
  it('suggest-fixes: moves come first, then swaps, then deferrals', () => {
    const { input, plan, violation } = overfull();
    const all = suggestFixes(input, plan, violation, 50);
    const order = { MOVE: 0, SWAP: 1, DEFER: 2 } as const;
    const ranks = kinds(all).map((k) => order[k]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(kinds(all))).toEqual(new Set(['MOVE', 'SWAP', 'DEFER']));
  });

  it('suggest-fixes: every suggestion clears the violation and adds no hard violation', () => {
    const { input, plan, violation } = overfull();
    const all = suggestFixes(input, plan, violation, 50);
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) {
      const after = applyEdits(input, plan, s.edits);
      expect(after.violations.map(violationKey)).not.toContain(violationKey(violation));
      expect(after.introduced.filter((v) => v.severity === 'HARD')).toEqual([]);
    }
  });

  it('suggest-fixes: the top suggestion moves the smallest order that clears it, to a trip that already exists', () => {
    const { input, plan, violation } = overfull();
    const [first] = suggestFixes(input, plan, violation);
    expect(first).toMatchObject({
      kind: 'MOVE',
      edits: [{ op: 'MOVE_ORDER', orderId: 'fx-ord-3', tripKey: 'REF-03#1' }],
    });
    expect(first?.label).toBe('Move FO-3 to REF-03 trip 1');
  });

  it('suggest-fixes: a move to a vehicle with no trip yet adds the trip first', () => {
    const { input, plan, violation } = overfull();
    const newTrip = suggestFixes(input, plan, violation, 50).find((s) => s.kind === 'MOVE' && s.edits.length === 2);
    expect(newTrip?.edits[0]).toEqual({ op: 'ADD_TRIP', vehicleId: 'fx-veh-3', tripNo: 1, brand: 'FRESH', districtId: 'fx-gampaha' });
    expect(newTrip?.edits[1]?.op).toBe('MOVE_ORDER');
  });

  it('suggest-fixes: a chilled order is never moved onto a vehicle that is not a reefer', () => {
    const { input, plan, violation } = overfull();
    const reefer = input.vehicles[0];
    if (!reefer) throw new Error('no vehicle');
    const withDry = { ...input, vehicles: [...input.vehicles, { ...reefer, id: 'fx-veh-4', code: 'DRY-31', temp: 'AMBIENT' as const }] };
    const all = suggestFixes(withDry, plan, violation, 50);
    expect(all.length).toBeGreaterThan(0);
    expect(JSON.stringify(all.map((s) => s.edits))).not.toContain('fx-veh-4');
  });

  it('suggest-fixes: a deferral removes the lowest-priority order that clears the violation', () => {
    const { input, plan, violation } = overfull();
    const defer = suggestFixes(input, plan, violation, 50).find((s) => s.kind === 'DEFER');
    expect(defer?.edits).toEqual([{ op: 'UNASSIGN_ORDER', orderId: 'fx-ord-3' }]);
    // Make o3 urgent: now the lowest priority is o2 (smaller than o1), so that is what gets deferred.
    const urgent = withOrder(input, 'fx-ord-3', { urgent: true });
    const v2 = applyEdits(urgent, plan, []).violations[0];
    if (!v2) throw new Error('expected a violation');
    const next = suggestFixes(urgent, plan, v2, 50).find((s) => s.kind === 'DEFER');
    expect(next?.edits).toEqual([{ op: 'UNASSIGN_ORDER', orderId: 'fx-ord-2' }]);
  });

  it('suggest-fixes: a swap takes an order off and puts an unplanned one of at least its priority on', () => {
    const { input, plan, violation } = overfull();
    const swaps = suggestFixes(input, plan, violation, 50).filter((s) => s.kind === 'SWAP');
    expect(swaps.length).toBeGreaterThan(0);
    for (const s of swaps) {
      expect(s.edits[0]).toMatchObject({ op: 'UNASSIGN_ORDER' });
      expect(s.edits[1]).toMatchObject({ op: 'ASSIGN_ORDER', tripKey: 'REF-07#1' });
      expect(['fx-ord-4', 'fx-ord-5']).toContain(s.edits[1] && 'orderId' in s.edits[1] ? s.edits[1].orderId : '');
    }
  });

  it('suggest-fixes: the limit caps the list, and the default is five', () => {
    const { input, plan, violation } = overfull();
    expect(suggestFixes(input, plan, violation, 2)).toHaveLength(2);
    expect(suggestFixes(input, plan, violation).length).toBeLessThanOrEqual(5);
  });

  it('suggest-fixes: a violation on a vehicle, not a trip, is fixed from the vehicle trips (BUDGET_FRESH)', () => {
    const f = readFixture('BUDGET_FRESH.fail.json');
    const base = buildInput(f.input, f.params);
    const v1 = base.vehicles[0];
    if (!v1) throw new Error('no vehicle');
    const input = { ...base, vehicles: [...base.vehicles, { ...v1, id: 'fx-veh-2', code: 'FV2' }] };
    const violation = validate(input, f.plan).find((v) => v.rule === 'BUDGET_FRESH');
    if (!violation) throw new Error('expected BUDGET_FRESH');
    const all = suggestFixes(input, f.plan, violation, 50);
    expect(kinds(all)).toContain('MOVE');
    for (const s of all) {
      const after = applyEdits(input, f.plan, s.edits);
      expect(after.violations.map(violationKey)).not.toContain(violationKey(violation));
      expect(after.introduced.filter((v) => v.severity === 'HARD')).toEqual([]);
    }
  });

  it('suggest-fixes: a soft violation or a plan-level one has no suggestions', () => {
    const input = buildInput({
      vehicles: [{ id: 'fx-veh-1' }],
      outlets: { 'fx-out-1': { windowCloseMin: 272 } },
      orders: [{ id: 'fx-ord-1', outletId: 'fx-out-1' }],
    });
    const plan = { trips: [trip('fx-veh-1', 1, ['fx-ord-1'])], unplanned: [] };
    const soft = validate(input, plan).find((v) => v.rule === 'LATE_RISK');
    if (!soft) throw new Error('expected LATE_RISK');
    expect(suggestFixes(input, plan, soft)).toEqual([]);
    const { input: i2, plan: p2 } = capacityScenario();
    const twice = { ...p2, trips: [...p2.trips, trip('fx-veh-3', 1, ['fx-ord-1'])] };
    const whole = validate(i2, twice).find((v) => v.rule === 'WHOLE_ORDER');
    if (!whole) throw new Error('expected WHOLE_ORDER');
    expect(suggestFixes(i2, twice, whole)).toEqual([]);
  });

  it('suggest-fixes: it is pure and gives the same answer every time', () => {
    const { input, plan, violation } = overfull();
    deepFreeze(input);
    deepFreeze(plan);
    deepFreeze(violation);
    const a = suggestFixes(input, plan, violation, 50);
    expect(suggestFixes(input, plan, violation, 50)).toEqual(a);
  });
});
