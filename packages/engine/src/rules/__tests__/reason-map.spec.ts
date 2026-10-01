import { describe, expect, it } from 'vitest';
import { BINDING_RULES } from '../codes';
import { DEFERRAL_REASONS, DEFERRAL_REASON_CODES, reasonCodeFor, reasonFor } from '../reason-map';

describe('reason map', () => {
  it('reason-map: every binding rule maps to a listed reason code', () => {
    for (const rule of BINDING_RULES) {
      expect(DEFERRAL_REASON_CODES).toContain(reasonCodeFor(rule));
    }
  });

  it('reason-map: rules map to the codes in specs/engine/rules.md', () => {
    expect(reasonCodeFor('TEMP_REEFER')).toBe('NO_REEFER_CAPACITY');
    expect(reasonCodeFor('ACCESS_VAN_ONLY')).toBe('VAN_SHORTAGE');
    for (const r of ['CAP_WEIGHT', 'CAP_VOLUME', 'TRIP_LIMIT'] as const) expect(reasonCodeFor(r)).toBe('OVER_CAPACITY');
    for (const r of ['BUDGET_FRESH', 'BUDGET_STYLE_TECH'] as const) expect(reasonCodeFor(r)).toBe('TIME_BUDGET');
    for (const r of ['WINDOW_OUTLET', 'WINDOW_MALL'] as const) expect(reasonCodeFor(r)).toBe('WINDOW_CONFLICT');
    expect(reasonCodeFor('FUEL_WEEKLY')).toBe('FUEL_QUOTA');
  });

  it('reason-map: an unavailable vehicle is a breakdown or fleet shortage, depending on why', () => {
    expect(reasonCodeFor('VEHICLE_AVAILABLE', { unavailableReason: 'BREAKDOWN' })).toBe('VEHICLE_BREAKDOWN');
    expect(reasonCodeFor('VEHICLE_AVAILABLE', { unavailableReason: 'WORKSHOP' })).toBe('OVER_CAPACITY');
    expect(reasonCodeFor('VEHICLE_AVAILABLE')).toBe('OVER_CAPACITY');
  });

  it('reason-map: dispatcher and store wording come from the table', () => {
    expect(reasonFor('TEMP_REEFER').dispatcherLabel).toBe('No reefer capacity');
    expect(reasonFor('TEMP_REEFER').storeText).toBe('All refrigerated trucks were full for this run.');
  });

  it('reason-map: the seed list has unique codes, engine reasons first, and the manual ones', () => {
    const codes = DEFERRAL_REASONS.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(DEFERRAL_REASONS.filter((r) => r.fromEngine).map((r) => r.code)).toEqual([
      ...DEFERRAL_REASON_CODES.filter((c) => !['ACCESS_ISSUE', 'STORE_REQUEST', 'OTHER'].includes(c)),
    ]);
    expect(codes).toEqual(expect.arrayContaining(['ACCESS_ISSUE', 'STORE_REQUEST', 'OTHER']));
  });
});
