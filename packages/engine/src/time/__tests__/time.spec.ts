import { describe, expect, it } from 'vitest';
import freshGampaha from '../../../fixtures/time/cases/fresh-gampaha-3-stops.json';
import freshColombo from '../../../fixtures/time/cases/fresh-colombo-4-stops.json';
import twoTrips from '../../../fixtures/time/cases/two-trips-one-vehicle.json';
import thirdTrip from '../../../fixtures/time/cases/third-trip-refused.json';
import { DEFAULT_PARAMS } from '../../params';
import type { Brand, DockType } from '../../domain';
import { lte } from '../../util/lte';
import { canAddTrip, budgetUse } from '../budget';
import { tripMinutes } from '../trip-minutes';

const brand = (b: string) => b as Brand;
const docks = (d: readonly string[]) => d as readonly DockType[];

describe('tripMinutes', () => {
  it('time: Fresh Gampaha trip is 101 minutes', () => {
    const minutes = tripMinutes({
      district: freshGampaha.district,
      brand: brand(freshGampaha.brand),
      dockTypes: docks(freshGampaha.dockTypes),
      allowances: freshGampaha.allowances,
    });
    expect(minutes).toBe(freshGampaha.expect.minutes);
    expect(minutes).toBe(101);
  });

  it('time: Fresh Colombo trip is 112 minutes', () => {
    const minutes = tripMinutes({
      district: freshColombo.district,
      brand: brand(freshColombo.brand),
      dockTypes: docks(freshColombo.dockTypes),
      allowances: freshColombo.allowances,
    });
    expect(minutes).toBe(freshColombo.expect.minutes);
    expect(minutes).toBe(112);
  });

  it('time: a trip with no stops is 0 minutes and stop order does not change it', () => {
    const base = {
      district: freshGampaha.district,
      brand: brand(freshGampaha.brand),
      allowances: freshGampaha.allowances,
    };
    expect(tripMinutes({ ...base, dockTypes: [] })).toBe(0);
    const forward = tripMinutes({ ...base, dockTypes: ['REAR_DOCK', 'REAR_DOCK', 'STREET'] });
    const reversed = tripMinutes({ ...base, dockTypes: ['STREET', 'REAR_DOCK', 'REAR_DOCK'] });
    expect(reversed).toBe(forward);
  });

  it('time: a single stop has no inter-stop travel', () => {
    const minutes = tripMinutes({
      district: freshGampaha.district,
      brand: brand(freshGampaha.brand),
      dockTypes: ['STREET'],
      allowances: freshGampaha.allowances,
    });
    expect(minutes).toBe(37 + 16);
  });

  it('time: a missing service allowance is an input error, not a silent zero', () => {
    expect(() =>
      tripMinutes({
        district: freshColombo.district,
        brand: 'STYLE',
        dockTypes: ['STREET'],
        allowances: freshColombo.allowances,
      }),
    ).toThrow('STYLE:STREET');
  });
});

describe('budgets and the trip limit', () => {
  const params = { ...DEFAULT_PARAMS, ...twoTrips.params };
  const trips = twoTrips.trips.map((t) => ({ brand: brand(t.brand), minutes: t.minutes }));

  it('time: one vehicle running both trips uses 213 of 270 Fresh minutes', () => {
    const use = budgetUse(trips);
    expect(use.freshMinutes).toBe(twoTrips.expect.freshMinutes);
    expect(use.freshMinutes).toBe(213);
    expect(use.styleTechMinutes).toBe(0);
    expect(lte(use.freshMinutes, params.freshBudgetMin)).toBe(true);
    expect(canAddTrip(trips.slice(0, 1), params)).toEqual({ ok: true });
  });

  it('time: a third trip is refused by TRIP_LIMIT although 57 minutes remain', () => {
    const remaining = params.freshBudgetMin - thirdTrip.existingFreshMinutes;
    expect(remaining).toBe(57);
    expect(lte(thirdTrip.addTrip.minutes, remaining)).toBe(true);
    expect(canAddTrip(trips, params)).toEqual({
      ok: false,
      refusedBy: thirdTrip.expect.refusedBy,
    });
  });

  it('time: Style and Tech minutes share one budget, apart from Fresh', () => {
    const use = budgetUse([
      { brand: 'FRESH', minutes: 100 },
      { brand: 'STYLE', minutes: 200 },
      { brand: 'TECH', minutes: 50 },
    ]);
    expect(use).toEqual({ freshMinutes: 100, styleTechMinutes: 250 });
  });
});
