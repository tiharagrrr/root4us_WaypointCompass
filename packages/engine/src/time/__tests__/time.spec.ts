import { describe, expect, it } from 'vitest';
import booklet101 from '../../../fixtures/time/booklet-101.json';
import booklet112 from '../../../fixtures/time/booklet-112.json';
import booklet213 from '../../../fixtures/time/booklet-213.json';
import bookletThirdTrip from '../../../fixtures/time/booklet-third-trip.json';
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
      district: booklet101.district,
      brand: brand(booklet101.brand),
      dockTypes: docks(booklet101.dockTypes),
      allowances: booklet101.allowances,
    });
    expect(minutes).toBe(booklet101.expect.minutes);
    expect(minutes).toBe(101);
  });

  it('time: Fresh Colombo trip is 112 minutes', () => {
    const minutes = tripMinutes({
      district: booklet112.district,
      brand: brand(booklet112.brand),
      dockTypes: docks(booklet112.dockTypes),
      allowances: booklet112.allowances,
    });
    expect(minutes).toBe(booklet112.expect.minutes);
    expect(minutes).toBe(112);
  });

  it('time: a trip with no stops is 0 minutes and stop order does not change it', () => {
    const base = {
      district: booklet101.district,
      brand: brand(booklet101.brand),
      allowances: booklet101.allowances,
    };
    expect(tripMinutes({ ...base, dockTypes: [] })).toBe(0);
    const forward = tripMinutes({ ...base, dockTypes: ['REAR_DOCK', 'REAR_DOCK', 'STREET'] });
    const reversed = tripMinutes({ ...base, dockTypes: ['STREET', 'REAR_DOCK', 'REAR_DOCK'] });
    expect(reversed).toBe(forward);
  });

  it('time: a single stop has no inter-stop travel', () => {
    const minutes = tripMinutes({
      district: booklet101.district,
      brand: brand(booklet101.brand),
      dockTypes: ['STREET'],
      allowances: booklet101.allowances,
    });
    expect(minutes).toBe(37 + 16);
  });

  it('time: a missing service allowance is an input error, not a silent zero', () => {
    expect(() =>
      tripMinutes({
        district: booklet112.district,
        brand: 'STYLE',
        dockTypes: ['STREET'],
        allowances: booklet112.allowances,
      }),
    ).toThrow('STYLE:STREET');
  });
});

describe('budgets and the trip limit', () => {
  const params = { ...DEFAULT_PARAMS, ...booklet213.params };
  const trips = booklet213.trips.map((t) => ({ brand: brand(t.brand), minutes: t.minutes }));

  it('time: one vehicle running both trips uses 213 of 270 Fresh minutes', () => {
    const use = budgetUse(trips);
    expect(use.freshMinutes).toBe(booklet213.expect.freshMinutes);
    expect(use.freshMinutes).toBe(213);
    expect(use.styleTechMinutes).toBe(0);
    expect(lte(use.freshMinutes, params.freshBudgetMin)).toBe(true);
    expect(canAddTrip(trips.slice(0, 1), params)).toEqual({ ok: true });
  });

  it('time: a third trip is refused by TRIP_LIMIT although 57 minutes remain', () => {
    const remaining = params.freshBudgetMin - bookletThirdTrip.existingFreshMinutes;
    expect(remaining).toBe(57);
    expect(lte(bookletThirdTrip.addTrip.minutes, remaining)).toBe(true);
    expect(canAddTrip(trips, params)).toEqual({
      ok: false,
      refusedBy: bookletThirdTrip.expect.refusedBy,
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
