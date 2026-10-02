import { describe, expect, it } from 'vitest';
import { ENGINE_INPUT_ERROR_CODES, EngineInputError } from '../errors';
import { buildInput, readFixture } from '../rules/__tests__/fixture';
import { tripMinutes } from '../time/trip-minutes';
import type { EngineInput, Plan } from '../types';
import { validate } from '../validate';

const load = (name: string) => {
  const f = readFixture(name);
  return { input: buildInput(f.input, f.params), plan: f.plan };
};

/** Runs fn and returns the EngineInputError it throws, failing the test if it throws anything else. */
function inputError(fn: () => unknown): EngineInputError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EngineInputError);
    return e as EngineInputError;
  }
  throw new Error('expected an EngineInputError, but nothing was thrown');
}

const firstTrip = (plan: Plan) => {
  const trip = plan.trips[0];
  if (!trip) throw new Error('fixture has no trips');
  return trip;
};

describe('EngineInputError says exactly what is wrong', () => {
  it('errors: it carries a code, the field, the value and a message naming all three', () => {
    const e = new EngineInputError({
      code: 'UNKNOWN_ORDER',
      field: 'plan.trips[1].orderIds[0]',
      value: 'ord-9',
      reason: 'is not in input.orders',
    });
    expect(e.name).toBe('EngineInputError');
    expect(e.code).toBe('UNKNOWN_ORDER');
    expect(e.field).toBe('plan.trips[1].orderIds[0]');
    expect(e.value).toBe('ord-9');
    expect(e.message).toBe('plan.trips[1].orderIds[0] "ord-9" is not in input.orders [UNKNOWN_ORDER]');
  });

  it('errors: it keeps the error that caused it', () => {
    const cause = new Error('underlying');
    const e = new EngineInputError({ code: 'INVALID_DATE', field: 'input.date', value: 'x', reason: 'is bad', cause });
    expect(e.cause).toBe(cause);
  });

  it('errors: every code in the list is one the tests below can produce', () => {
    expect([...ENGINE_INPUT_ERROR_CODES].sort()).toEqual(
      ['INVALID_DATE', 'MISSING_ALLOWANCE', 'UNKNOWN_DISTRICT', 'UNKNOWN_ORDER', 'UNKNOWN_OUTLET', 'UNKNOWN_VEHICLE'].sort(),
    );
  });
});

describe('where each input error comes from', () => {
  it('errors: an unknown order names the trip and the position in its order list', () => {
    const { input, plan } = load('CAP_WEIGHT.pass.json');
    const base = firstTrip(plan);
    const e = inputError(() => validate(input, { ...plan, trips: [{ ...base, orderIds: [...base.orderIds, 'nope'] }] }));
    expect(e).toMatchObject({ code: 'UNKNOWN_ORDER', field: 'plan.trips[0].orderIds[2]', value: 'nope' });
    expect(e.message).toBe('plan.trips[0].orderIds[2] "nope" is not in input.orders [UNKNOWN_ORDER]');
  });

  it('errors: an unknown vehicle names the trip', () => {
    const { input, plan } = load('CAP_WEIGHT.pass.json');
    const e = inputError(() => validate(input, { ...plan, trips: [{ ...firstTrip(plan), vehicleId: 'nope' }] }));
    expect(e).toMatchObject({ code: 'UNKNOWN_VEHICLE', field: 'plan.trips[0].vehicleId', value: 'nope' });
  });

  it('errors: an unknown district names the trip', () => {
    const { input, plan } = load('CAP_WEIGHT.pass.json');
    const e = inputError(() => validate(input, { ...plan, trips: [{ ...firstTrip(plan), districtId: 'nope' }] }));
    expect(e).toMatchObject({ code: 'UNKNOWN_DISTRICT', field: 'plan.trips[0].districtId', value: 'nope' });
  });

  it('errors: the index is the trip that is wrong, not the first one', () => {
    const { input, plan } = load('WHOLE_ORDER.pass.json');
    const [a, b] = plan.trips;
    if (!a || !b) throw new Error('fixture needs two trips');
    const e = inputError(() => validate(input, { ...plan, trips: [a, { ...b, vehicleId: 'nope' }] }));
    expect(e.field).toBe('plan.trips[1].vehicleId');
  });

  it('errors: an order whose outlet is missing names the order and the outlet', () => {
    const { input, plan } = load('CAP_WEIGHT.pass.json');
    const order = input.orders[0];
    if (!order) throw new Error('fixture has no orders');
    const broken: EngineInput = { ...input, orders: [{ ...order, outletId: 'fx-out-9' }, ...input.orders.slice(1)] };
    const e = inputError(() => validate(broken, plan));
    expect(e).toMatchObject({ code: 'UNKNOWN_OUTLET', field: `input.orders["${order.id}"].outletId`, value: 'fx-out-9' });
  });

  it('errors: a missing service allowance names the brand and the dock type', () => {
    const e = inputError(() =>
      tripMinutes({ district: { depotToDistrictMin: 10, interStopMin: 2 }, brand: 'STYLE', dockTypes: ['STREET'], allowances: {} }),
    );
    expect(e).toMatchObject({ code: 'MISSING_ALLOWANCE', field: 'input.allowances', value: 'STYLE:STREET' });
    expect(e.message).toBe(
      'input.allowances "STYLE:STREET" has no service allowance for this brand and dock type [MISSING_ALLOWANCE]',
    );
  });
});

describe('the plan date is checked every time, from the engine side', () => {
  // The engine relies on @waypoint/shared's dowOf to refuse impossible dates. These tests pin that
  // contract here, so a change in shared that weakens it fails an engine test, not just a shared one.
  const BAD_DATES = [
    ['a day that does not exist', '2026-02-30'],
    ['29 February in a common year', '2025-02-29'],
    ['31 April', '2026-04-31'],
    ['month 13', '2026-13-01'],
    ['month 0', '2026-00-10'],
    ['day 0', '2026-10-00'],
    ['two-digit year', '26-10-02'],
    ['slashes', '2026/10/02'],
    ['a timestamp', '2026-10-02T00:00:00Z'],
    ['empty', ''],
  ] as const;

  const emptyPlan: Plan = { trips: [], unplanned: [] };

  it.each(BAD_DATES)('errors: %s is refused even when the plan is empty', (_why, date) => {
    const { input } = load('CAP_WEIGHT.pass.json');
    const e = inputError(() => validate({ ...input, date }, emptyPlan));
    expect(e).toMatchObject({ code: 'INVALID_DATE', field: 'input.date', value: date });
    expect(e.message).toContain('is not a calendar date');
    expect(e.cause).toBeInstanceOf(Error);
  });

  it('errors: real dates are accepted, including a leap day', () => {
    const { input } = load('CAP_WEIGHT.pass.json');
    for (const date of ['2024-02-29', '2026-10-02', '2026-12-31', '2026-01-01']) {
      expect(validate({ ...input, date }, emptyPlan)).toEqual([]);
    }
  });

  it('errors: a bad date is refused on a non-operating day too', () => {
    const { input } = load('CAP_WEIGHT.pass.json');
    const e = inputError(() => validate({ ...input, date: '2026-02-30', isOperatingDay: false }, emptyPlan));
    expect(e.code).toBe('INVALID_DATE');
  });
});
