import { describe, expect, it } from 'vitest';
import { weekdayOf } from '../date';
import { lte, round } from '../lte';
import { formatMinutes } from '../time-format';
import { compareByPriorityThenId, stableSort } from '../stable-sort';

describe('lte', () => {
  it('util: lte() accepts a 1e-6 overshoot and rejects more', () => {
    expect(lte(10, 10)).toBe(true);
    expect(lte(10 + 5e-7, 10)).toBe(true);
    expect(lte(10 + 2e-6, 10)).toBe(false);
    expect(lte(0.1 + 0.2, 0.3)).toBe(true);
  });
});

describe('round', () => {
  it('util: round() rounds half away from zero to the given digits', () => {
    expect(round(1.005 + 1e-9, 2)).toBe(1.01);
    expect(round(2.345678, 2)).toBe(2.35);
    expect(round(-2.5, 0)).toBe(-3);
  });
});

describe('stableSort', () => {
  it('util: stableSort orders by priority desc, then id, and does not mutate its input', () => {
    const items = [
      { id: 'b', priority: 10 },
      { id: 'a', priority: 10 },
      { id: 'c', priority: 40 },
      { id: 'd', priority: 0 },
    ];
    const snapshot = structuredClone(items);
    const sorted = stableSort(items, compareByPriorityThenId);
    expect(sorted.map((x) => x.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(items).toEqual(snapshot);
  });

  it('util: stableSort keeps equal items in their input order', () => {
    const items = [
      { k: 1, tag: 'first' },
      { k: 1, tag: 'second' },
      { k: 0, tag: 'third' },
    ];
    const sorted = stableSort(items, (a, b) => a.k - b.k);
    expect(sorted.map((x) => x.tag)).toEqual(['third', 'first', 'second']);
  });
});

describe('weekdayOf', () => {
  it('util: weekdayOf gives 0 for Monday from the date string alone', () => {
    expect(weekdayOf('2026-09-28')).toBe(0);
    expect(weekdayOf('2026-10-02')).toBe(4);
    expect(weekdayOf('2026-10-04')).toBe(6);
    expect(weekdayOf('2024-02-29')).toBe(3);
  });

  it('util: weekdayOf rejects a date that does not exist', () => {
    expect(() => weekdayOf('2026-02-30')).toThrow('2026-02-30');
    expect(() => weekdayOf('02/10/2026')).toThrow();
  });
});

describe('formatMinutes', () => {
  it('util: formatMinutes prints minutes after midnight as HH:MM', () => {
    expect(formatMinutes(210)).toBe('03:30');
    expect(formatMinutes(490)).toBe('08:10');
    expect(formatMinutes(0)).toBe('00:00');
  });
});
