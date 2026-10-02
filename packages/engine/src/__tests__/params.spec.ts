import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, engineParamsSchema, resolveParams } from '../params';

describe('params', () => {
  it('params: DEFAULT_PARAMS satisfies its own schema', () => {
    expect(engineParamsSchema.parse(DEFAULT_PARAMS)).toEqual(DEFAULT_PARAMS);
  });

  it('params: an override replaces only the named fields', () => {
    const params = resolveParams({ freshBudgetMin: 240 });
    expect(params).toEqual({ ...DEFAULT_PARAMS, freshBudgetMin: 240 });
  });

  it('params: no override gives the defaults', () => {
    expect(resolveParams()).toEqual(DEFAULT_PARAMS);
  });

  it('params: a non-positive budget or a fractional trip limit is rejected', () => {
    expect(() => resolveParams({ freshBudgetMin: 0 })).toThrow();
    expect(() => resolveParams({ styleTechBudgetMin: -5 })).toThrow();
    expect(() => resolveParams({ maxTripsPerVehicle: 1.5 })).toThrow();
  });

  it('params: a start time outside the day is rejected', () => {
    expect(() => resolveParams({ freshStartMin: 1440 })).toThrow();
    expect(() => resolveParams({ freshStartMin: -1 })).toThrow();
  });

  it('params: an unknown key is rejected', () => {
    expect(() => engineParamsSchema.parse({ ...DEFAULT_PARAMS, freshBudget: 1 })).toThrow();
  });
});

describe('params for the rules', () => {
  it('params: windows, fuel and reefer-carries-ambient are on by default, the Tech value limit is off', () => {
    expect(DEFAULT_PARAMS).toMatchObject({
      enforceWindows: true,
      enforceFuel: true,
      reeferCarriesAmbient: true,
      techValueLimitLkr: null,
      lateRiskSlackMin: 15,
      repeatSkipLookbackRuns: 1,
    });
  });

  it('params: the Tech value limit can be set, and must be positive when it is', () => {
    expect(resolveParams({ techValueLimitLkr: 250000 }).techValueLimitLkr).toBe(250000);
    expect(() => resolveParams({ techValueLimitLkr: 0 })).toThrow();
  });

  it('params: the slack and look-back values are validated', () => {
    expect(() => resolveParams({ lateRiskSlackMin: -1 })).toThrow();
    expect(() => resolveParams({ repeatSkipLookbackRuns: 0 })).toThrow();
  });
});
