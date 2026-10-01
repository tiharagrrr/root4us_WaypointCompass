import { describe, expect, it } from 'vitest';
import { tripKm, tripLitres } from '../fuel';

// Hand-made distances, not dataset rows.
const district = { depotToDistrictKm: 22, interStopKm: 5 };

describe('fuel', () => {
  it('fuel: km counts the return leg and the inter-stop legs', () => {
    expect(tripKm(district, 3)).toBe(2 * 22 + 5 * 2);
    expect(tripKm(district, 1)).toBe(44);
  });

  it('fuel: a trip with no stops uses no fuel', () => {
    expect(tripKm(district, 0)).toBe(0);
    expect(tripLitres(0, 6)).toBe(0);
  });

  it('fuel: litres are km divided by km per litre', () => {
    expect(tripLitres(54, 6)).toBe(9);
    expect(tripLitres(33, 11)).toBe(3);
  });
});
