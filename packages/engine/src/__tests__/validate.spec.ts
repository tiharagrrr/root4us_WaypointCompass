import { describe, expect, it } from 'vitest';
import { EngineInputError } from '../errors';
import { buildInput, readFixture } from '../rules/__tests__/fixture';
import { validate } from '../validate';

const load = (name: string) => {
  const f = readFixture(name);
  return { input: buildInput(f.input, f.params), plan: f.plan };
};

describe('validate', () => {
  it('validate: a violation carries tripKey, actual, limit and a human message', () => {
    const { input, plan } = load('CAP_VOLUME.fail.json');
    expect(validate(input, plan)).toEqual([
      {
        rule: 'CAP_VOLUME',
        severity: 'HARD',
        scope: 'trip',
        tripKey: 'FV1#1',
        vehicleId: 'fx-veh-1',
        actual: 1.25,
        limit: 1,
        message: 'Over volume by 0.25 m³',
      },
    ]);
  });

  it('validate: totals come from the orders, not from the plan', () => {
    const { input, plan } = load('CAP_WEIGHT.fail.json');
    const stale = { ...plan, trips: plan.trips.map((t) => ({ ...t, weightKg: 1 })) };
    expect(validate(input, stale).map((v) => v.rule)).toEqual(['CAP_WEIGHT']);
  });

  it('validate: the same plan in a different order gives identical output', () => {
    const { input, plan } = load('WHOLE_ORDER.fail.json');
    const flipped = { ...plan, trips: [...plan.trips].reverse() };
    expect(validate(input, flipped)).toEqual(validate(input, plan));
  });

  it('validate: fixed trips count towards the trip limit and the budgets', () => {
    const { input, plan } = load('TRIP_LIMIT.pass.json');
    const fixed = {
      key: 'FV1#2',
      vehicleId: 'fx-veh-1',
      tripNo: 2,
      brand: 'FRESH' as const,
      districtId: 'fx-gampaha',
      orderIds: [],
      minutes: 0,
      km: 0,
      litres: 0,
      weightKg: 0,
      volumeM3: 0,
    };
    const withFixed = { ...input, fixedTrips: [fixed] };
    const onePlanned = { ...plan, trips: plan.trips.slice(0, 1) };
    expect(validate(withFixed, onePlanned)).toEqual([]);
    const v = validate({ ...withFixed, fixedTrips: [fixed, { ...fixed, key: 'FV1#3', tripNo: 3 }] }, onePlanned);
    expect(v.map((x) => x.rule)).toEqual(['TRIP_LIMIT']);
  });

  it('validate: a plan with no trips has no violations', () => {
    const { input } = load('CAP_WEIGHT.pass.json');
    expect(validate(input, { trips: [], unplanned: [] })).toEqual([]);
  });

  it('validate: an unknown order, vehicle or district is an input error', () => {
    const { input, plan } = load('CAP_WEIGHT.pass.json');
    const base = plan.trips[0];
    if (!base) throw new Error('fixture has no trips');
    expect(() => validate(input, { ...plan, trips: [{ ...base, orderIds: ['nope'] }] })).toThrow(EngineInputError);
    expect(() => validate(input, { ...plan, trips: [{ ...base, vehicleId: 'nope' }] })).toThrow(EngineInputError);
    expect(() => validate(input, { ...plan, trips: [{ ...base, districtId: 'nope' }] })).toThrow(EngineInputError);
  });

  it('validate: an explicit departMin moves the window checks', () => {
    const { input, plan } = load('WINDOW_OUTLET.fail.json');
    const early = { ...plan, trips: plan.trips.map((t) => ({ ...t, departMin: 100 })) };
    expect(validate(input, early).filter((v) => v.rule === 'WINDOW_OUTLET')).toEqual([]);
  });

  it('validate: Style and Tech trips arrive when the first window opens', () => {
    const f = readFixture('WINDOW_OUTLET.pass.json');
    const input = buildInput(
      {
        ...f.input,
        orders: [{ id: 'fx-ord-1', outletId: 'fx-out-1', brand: 'STYLE' }],
        outlets: { 'fx-out-1': { windowOpenMin: 540, windowCloseMin: 560 } },
      },
      f.params,
    );
    const plan = { trips: [{ vehicleId: 'fx-veh-1', tripNo: 1, brand: 'STYLE' as const, districtId: 'fx-gampaha', orderIds: ['fx-ord-1'] }], unplanned: [] };
    expect(validate(input, plan).filter((v) => v.rule === 'WINDOW_OUTLET')).toEqual([]);
  });

  it('validate: a window message prints the times as HH:MM', () => {
    const { input, plan } = load('WINDOW_OUTLET.fail.json');
    const v = validate(input, plan).filter((x) => x.rule === 'WINDOW_OUTLET');
    expect(v[0]?.message).toBe('FO-4 is served 05:19 to 05:34, outside its window 00:00 to 05:20');
  });

  it('validate: a date that does not exist is an input error, not a rolled-over weekday', () => {
    const f = readFixture('OPERATING_DAY.pass.json');
    const input = buildInput({ ...f.input, date: '2026-02-30' }, f.params);
    expect(() => validate(input, f.plan)).toThrow(EngineInputError);
  });
});
