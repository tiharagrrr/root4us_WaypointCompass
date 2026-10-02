import { describe, expect, it } from 'vitest';
import { EngineInputError } from '../../errors';
import type { Plan, Trip } from '../../types';
import { applyEdits } from '../apply-edits';
import type { EditOp } from '../edit-ops';
import { buildInput } from '../../rules/__tests__/fixture';
import { capacityScenario, deepFreeze, ordersByTrip, trip, withOrder } from './scenarios';

const FIXED: Trip = {
  key: 'REF-11#1',
  vehicleId: 'fx-veh-3',
  tripNo: 1,
  brand: 'FRESH',
  districtId: 'fx-gampaha',
  orderIds: ['fx-ord-4'],
  minutes: 52,
  km: 44,
  litres: 8.8,
  weightKg: 10,
  volumeM3: 0.5,
};

function failure(fn: () => unknown): EngineInputError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EngineInputError);
    return e as EngineInputError;
  }
  throw new Error('expected an EngineInputError');
}

describe('applyEdits builds and changes a plan', () => {
  it('apply-edits: ADD_TRIP then ASSIGN_ORDER builds a trip with the orders in stop order (AC-PLN-13)', () => {
    const { input, plan } = capacityScenario();
    const edits: EditOp[] = [
      { op: 'ADD_TRIP', vehicleId: 'fx-veh-3', tripNo: 1, brand: 'FRESH', districtId: 'fx-gampaha' },
      { op: 'ASSIGN_ORDER', orderId: 'fx-ord-4', tripKey: 'REF-11#1' },
      { op: 'ASSIGN_ORDER', orderId: 'fx-ord-5', tripKey: 'REF-11#1' },
    ];
    const result = applyEdits(input, plan, edits);
    expect(ordersByTrip(result.plan)).toEqual({
      'REF-03#1': ['fx-ord-3'],
      'REF-07#1': ['fx-ord-1', 'fx-ord-2'],
      'REF-11#1': ['fx-ord-4', 'fx-ord-5'],
    });
    expect(result.violations).toEqual([]);
    expect(result.introduced).toEqual([]);
  });

  it('apply-edits: a position puts the order there, and 0 puts it first', () => {
    const { input, plan } = capacityScenario();
    const r = applyEdits(input, plan, [{ op: 'ASSIGN_ORDER', orderId: 'fx-ord-4', tripKey: 'REF-07#1', position: 0 }]);
    expect(ordersByTrip(r.plan)['REF-07#1']).toEqual(['fx-ord-4', 'fx-ord-1', 'fx-ord-2']);
  });

  it('apply-edits: UNASSIGN_ORDER takes the order off its trip and leaves the trip', () => {
    const { input, plan } = capacityScenario();
    const r = applyEdits(input, plan, [{ op: 'UNASSIGN_ORDER', orderId: 'fx-ord-2' }]);
    expect(ordersByTrip(r.plan)['REF-07#1']).toEqual(['fx-ord-1']);
  });

  it('apply-edits: REMOVE_TRIP removes the trip, and its orders go on the unplanned list', () => {
    const { input, plan } = capacityScenario();
    const r = applyEdits(input, plan, [{ op: 'REMOVE_TRIP', tripKey: 'REF-03#1' }]);
    expect(Object.keys(ordersByTrip(r.plan))).toEqual(['REF-07#1']);
    expect(r.plan.unplanned.map((u) => u.orderId)).toEqual(['fx-ord-3']);
  });

  it('apply-edits: MOVE_ORDER onto a full vehicle returns the CAP_VOLUME violation (AC-PLN-02)', () => {
    const { input, plan } = capacityScenario();
    const r = applyEdits(input, plan, [{ op: 'MOVE_ORDER', orderId: 'fx-ord-3', tripKey: 'REF-07#1' }]);
    const expected = {
      rule: 'CAP_VOLUME',
      severity: 'HARD',
      scope: 'trip',
      tripKey: 'REF-07#1',
      vehicleId: 'fx-veh-1',
      actual: 12.42,
      limit: 12,
      message: 'Over volume by 0.42 m³',
    };
    expect(r.violations).toEqual([expected]);
    expect(r.introduced).toEqual([expected]);
    expect(ordersByTrip(r.plan)).toEqual({ 'REF-03#1': [], 'REF-07#1': ['fx-ord-1', 'fx-ord-2', 'fx-ord-3'] });
  });

  it('apply-edits: RESEQUENCE changes the stop order', () => {
    const { input, plan } = capacityScenario();
    const r = applyEdits(input, plan, [{ op: 'RESEQUENCE', tripKey: 'REF-07#1', orderIds: ['fx-ord-2', 'fx-ord-1'] }]);
    expect(ordersByTrip(r.plan)['REF-07#1']).toEqual(['fx-ord-2', 'fx-ord-1']);
  });

  it('apply-edits: an order that gets a trip leaves the unplanned list', () => {
    const { input, plan } = capacityScenario();
    const unplanned = { orderId: 'fx-ord-4', reasonCode: 'OVER_CAPACITY', bindingRule: 'CAP_VOLUME', choice: 'UNAVOIDABLE', priority: 25, repeatSkip: false } as const;
    const withUnplanned: Plan = { ...plan, unplanned: [unplanned] };
    const r = applyEdits(input, withUnplanned, [{ op: 'ASSIGN_ORDER', orderId: 'fx-ord-4', tripKey: 'REF-03#1' }]);
    expect(r.plan.unplanned).toEqual([]);
  });

  it('apply-edits: edits apply in order, so an op can use a trip an earlier op added', () => {
    const { input, plan } = capacityScenario();
    const add: EditOp = { op: 'ADD_TRIP', vehicleId: 'fx-veh-3', tripNo: 1, brand: 'FRESH', districtId: 'fx-gampaha' };
    const use: EditOp = { op: 'ASSIGN_ORDER', orderId: 'fx-ord-4', tripKey: 'REF-11#1' };
    expect(() => applyEdits(input, plan, [add, use])).not.toThrow();
    expect(failure(() => applyEdits(input, plan, [use, add])).field).toBe('edits[0].tripKey');
  });

  it('apply-edits: a rule violation is returned, not thrown (a Style order on a Fresh trip)', () => {
    const { input, plan } = capacityScenario();
    const style = withOrder(input, 'fx-ord-4', { brand: 'STYLE' });
    const r = applyEdits(style, plan, [{ op: 'ASSIGN_ORDER', orderId: 'fx-ord-4', tripKey: 'REF-03#1' }]);
    expect(r.introduced.map((v) => v.rule)).toEqual(['TRIP_BRAND_DISTRICT']);
  });

  it('apply-edits: introduced holds only what the edits caused, not what was already wrong', () => {
    const { input, plan } = capacityScenario();
    const over = applyEdits(input, plan, [{ op: 'MOVE_ORDER', orderId: 'fx-ord-3', tripKey: 'REF-07#1' }]);
    const harmless = applyEdits(input, over.plan, [{ op: 'ADD_TRIP', vehicleId: 'fx-veh-3', tripNo: 1, brand: 'FRESH', districtId: 'fx-gampaha' }]);
    expect(harmless.violations).toHaveLength(1);
    expect(harmless.introduced).toEqual([]);
  });
});

describe('an order taken off a trip is unplanned', () => {
  // fx-ord-2 is at an outlet that was deferred on its last run: a repeat skip if left off again.
  const repeatSkipWorld = () => {
    const input = buildInput({
      vehicles: [{ id: 'fx-veh-1' }],
      outlets: { 'fx-out-1': {}, 'fx-out-2': {} },
      orders: [
        { id: 'fx-ord-1', outletId: 'fx-out-1' },
        { id: 'fx-ord-2', outletId: 'fx-out-2' },
        { id: 'fx-ord-3', outletId: 'fx-out-1' },
      ],
      history: { 'fx-out-2': { deferredOnLastRun: true, consecutiveDeferrals: 1, daysSinceLastServed: 2 } },
    });
    const plan: Plan = { trips: [trip('fx-veh-1', 1, ['fx-ord-1', 'fx-ord-2', 'fx-ord-3'])], unplanned: [] };
    return { input, plan };
  };

  it('apply-edits: UNASSIGN_ORDER puts the order on plan.unplanned, with no reason yet', () => {
    const { input, plan } = repeatSkipWorld();
    const r = applyEdits(input, plan, [{ op: 'UNASSIGN_ORDER', orderId: 'fx-ord-1' }]);
    // 15 for a Fresh order, nothing else: no history, a wide window.
    expect(r.plan.unplanned).toEqual([
      { orderId: 'fx-ord-1', reasonCode: null, bindingRule: null, choice: null, priority: 15, repeatSkip: false },
    ]);
  });

  it('apply-edits: leaving a repeat-skip order off raises REPEAT_SKIP in the same edit', () => {
    const { input, plan } = repeatSkipWorld();
    const r = applyEdits(input, plan, [{ op: 'UNASSIGN_ORDER', orderId: 'fx-ord-2' }]);
    expect(r.plan.unplanned).toEqual([
      // 40 deferred on the last run, 10 for one deferral, 4 for two days, 15 for Fresh.
      { orderId: 'fx-ord-2', reasonCode: null, bindingRule: null, choice: null, priority: 69, repeatSkip: true },
    ]);
    expect(r.introduced).toEqual([
      {
        rule: 'REPEAT_SKIP',
        severity: 'SOFT',
        scope: 'order',
        orderId: 'fx-ord-2',
        message: 'fx-out-2 was deferred on its last run; deferring it again needs a note',
      },
    ]);
  });

  it('apply-edits: REMOVE_TRIP puts every order of the trip on the unplanned list', () => {
    const { input, plan } = repeatSkipWorld();
    const r = applyEdits(input, plan, [{ op: 'REMOVE_TRIP', tripKey: 'FV1#1' }]);
    expect(r.plan.unplanned.map((u) => u.orderId)).toEqual(['fx-ord-1', 'fx-ord-2', 'fx-ord-3']);
    expect(r.plan.unplanned.find((u) => u.orderId === 'fx-ord-2')?.repeatSkip).toBe(true);
  });

  it('apply-edits: an order unassigned and put back in the same list is not unplanned', () => {
    const { input, plan } = repeatSkipWorld();
    const r = applyEdits(input, plan, [
      { op: 'UNASSIGN_ORDER', orderId: 'fx-ord-2' },
      { op: 'ASSIGN_ORDER', orderId: 'fx-ord-2', tripKey: 'FV1#1' },
    ]);
    expect(r.plan.unplanned).toEqual([]);
    expect(r.introduced).toEqual([]);
  });

  it('apply-edits: MOVE_ORDER does not make an order unplanned', () => {
    const { input, plan } = capacityScenario();
    const r = applyEdits(input, plan, [{ op: 'MOVE_ORDER', orderId: 'fx-ord-3', tripKey: 'REF-07#1' }]);
    expect(r.plan.unplanned).toEqual([]);
  });

  it('apply-edits: entries are kept in order-id order, and one already listed is not added twice', () => {
    const { input, plan } = repeatSkipWorld();
    const earlier = { orderId: 'fx-ord-9', reasonCode: 'OVER_CAPACITY', bindingRule: 'CAP_WEIGHT', choice: 'UNAVOIDABLE', priority: 20, repeatSkip: false } as const;
    const r = applyEdits(input, { ...plan, unplanned: [earlier] }, [
      { op: 'UNASSIGN_ORDER', orderId: 'fx-ord-3' },
      { op: 'UNASSIGN_ORDER', orderId: 'fx-ord-1' },
    ]);
    expect(r.plan.unplanned.map((u) => u.orderId)).toEqual(['fx-ord-1', 'fx-ord-3', 'fx-ord-9']);
    expect(r.plan.unplanned.at(-1)).toEqual(earlier);
  });
});

describe('applyEdits is pure and deterministic', () => {
  it('apply-edits: it never mutates its input or the plan', () => {
    const { input, plan } = capacityScenario();
    const edits: EditOp[] = [
      { op: 'MOVE_ORDER', orderId: 'fx-ord-3', tripKey: 'REF-07#1' },
      { op: 'ASSIGN_ORDER', orderId: 'fx-ord-4', tripKey: 'REF-03#1' },
    ];
    deepFreeze(input);
    deepFreeze(plan);
    deepFreeze(edits);
    expect(() => applyEdits(input, plan, edits)).not.toThrow();
  });

  it('apply-edits: the same edits give identical output, with trips sorted by key', () => {
    const { input, plan } = capacityScenario();
    const edits: EditOp[] = [{ op: 'ADD_TRIP', vehicleId: 'fx-veh-3', tripNo: 1, brand: 'FRESH', districtId: 'fx-gampaha' }];
    const a = applyEdits(input, plan, edits);
    const b = applyEdits(input, { ...plan, trips: [...plan.trips].reverse() }, edits);
    expect(b).toEqual(a);
    expect(Object.keys(ordersByTrip(a.plan))).toEqual(['REF-03#1', 'REF-07#1', 'REF-11#1']);
  });

  it('apply-edits: an empty edit list returns the plan with its violations', () => {
    const { input, plan } = capacityScenario();
    const r = applyEdits(input, plan, []);
    expect(r.violations).toEqual([]);
    expect(ordersByTrip(r.plan)).toEqual(ordersByTrip(plan));
  });
});

describe('applyEdits says exactly what is wrong with an edit', () => {
  const { input, plan } = capacityScenario();
  const run = (edits: EditOp[], i = input) => failure(() => applyEdits(i, plan, edits));

  it('apply-edits: UNKNOWN_TRIP names the edit and the key', () => {
    expect(run([{ op: 'REMOVE_TRIP', tripKey: 'NOPE#1' }])).toMatchObject({ code: 'UNKNOWN_TRIP', field: 'edits[0].tripKey', value: 'NOPE#1' });
  });

  it('apply-edits: FIXED_TRIP refuses to edit a released or in-progress trip', () => {
    const e = run([{ op: 'REMOVE_TRIP', tripKey: 'REF-11#1' }], { ...input, fixedTrips: [FIXED] });
    expect(e).toMatchObject({ code: 'FIXED_TRIP', field: 'edits[0].tripKey', value: 'REF-11#1' });
  });

  it('apply-edits: TRIP_EXISTS refuses to add a trip that is already there', () => {
    const e = run([{ op: 'ADD_TRIP', vehicleId: 'fx-veh-1', tripNo: 1, brand: 'FRESH', districtId: 'fx-gampaha' }]);
    expect(e).toMatchObject({ code: 'TRIP_EXISTS', field: 'edits[0].tripNo', value: 'REF-07#1' });
  });

  it('apply-edits: ORDER_ALREADY_ASSIGNED, including an order on a fixed trip', () => {
    expect(run([{ op: 'ASSIGN_ORDER', orderId: 'fx-ord-1', tripKey: 'REF-03#1' }])).toMatchObject({
      code: 'ORDER_ALREADY_ASSIGNED',
      field: 'edits[0].orderId',
      value: 'fx-ord-1',
    });
    const e = run([{ op: 'ASSIGN_ORDER', orderId: 'fx-ord-4', tripKey: 'REF-03#1' }], { ...input, fixedTrips: [FIXED] });
    expect(e.code).toBe('ORDER_ALREADY_ASSIGNED');
  });

  it('apply-edits: ORDER_NOT_ASSIGNED for an unassign or a move of an order that is on no trip', () => {
    expect(run([{ op: 'UNASSIGN_ORDER', orderId: 'fx-ord-4' }])).toMatchObject({ code: 'ORDER_NOT_ASSIGNED', field: 'edits[0].orderId', value: 'fx-ord-4' });
    expect(run([{ op: 'MOVE_ORDER', orderId: 'fx-ord-4', tripKey: 'REF-03#1' }]).code).toBe('ORDER_NOT_ASSIGNED');
  });

  it('apply-edits: UNKNOWN_ORDER, UNKNOWN_VEHICLE and UNKNOWN_DISTRICT name the field', () => {
    expect(run([{ op: 'ASSIGN_ORDER', orderId: 'nope', tripKey: 'REF-03#1' }])).toMatchObject({ code: 'UNKNOWN_ORDER', field: 'edits[0].orderId', value: 'nope' });
    expect(run([{ op: 'ADD_TRIP', vehicleId: 'nope', tripNo: 1, brand: 'FRESH', districtId: 'fx-gampaha' }])).toMatchObject({ code: 'UNKNOWN_VEHICLE', field: 'edits[0].vehicleId' });
    expect(run([{ op: 'ADD_TRIP', vehicleId: 'fx-veh-3', tripNo: 1, brand: 'FRESH', districtId: 'nope' }])).toMatchObject({ code: 'UNKNOWN_DISTRICT', field: 'edits[0].districtId' });
  });

  it('apply-edits: INVALID_RESEQUENCE says what is missing or extra', () => {
    const missing = run([{ op: 'RESEQUENCE', tripKey: 'REF-07#1', orderIds: ['fx-ord-1'] }]);
    expect(missing).toMatchObject({ code: 'INVALID_RESEQUENCE', field: 'edits[0].orderIds' });
    expect(missing.message).toContain('missing fx-ord-2');
    const extra = run([{ op: 'RESEQUENCE', tripKey: 'REF-07#1', orderIds: ['fx-ord-1', 'fx-ord-2', 'fx-ord-9'] }]);
    expect(extra.message).toContain('extra fx-ord-9');
  });

  it('apply-edits: INVALID_POSITION when the position is past the end of the trip', () => {
    const e = run([{ op: 'ASSIGN_ORDER', orderId: 'fx-ord-4', tripKey: 'REF-07#1', position: 3 }]);
    expect(e).toMatchObject({ code: 'INVALID_POSITION', field: 'edits[0].position', value: '3' });
    expect(e.message).toContain('0 to 2');
  });

  it('apply-edits: the index is the edit that is wrong, not the first one', () => {
    const e = run([
      { op: 'UNASSIGN_ORDER', orderId: 'fx-ord-1' },
      { op: 'UNASSIGN_ORDER', orderId: 'fx-ord-1' },
    ]);
    expect(e).toMatchObject({ code: 'ORDER_NOT_ASSIGNED', field: 'edits[1].orderId' });
  });
});
