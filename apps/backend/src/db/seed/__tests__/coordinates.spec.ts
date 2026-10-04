import {
  DEPOT_COORDS,
  DISTRICT_CENTROIDS,
  outletPosition,
  TOWN_COORDS,
  townOf,
} from '../coordinates';
import { PERSONA_OUTLET, TOWNS } from '../outlet-names';

/** Sri Lanka's bounding box, the same one the ping pipeline checks. */
const inSriLanka = ([lat, lng]: readonly [number, number]) =>
  lat >= 5.85 && lat <= 9.9 && lng >= 79.5 && lng <= 81.95;

describe('map positions for the seed', () => {
  it('knows every town an outlet is named after, and the persona outlet', () => {
    const missing = Object.values(TOWNS)
      .flat()
      .filter((town) => !(town in TOWN_COORDS));
    expect(missing).toEqual([]);
    expect(townOf(PERSONA_OUTLET.name)).toBe('Kadawatha');
  });

  it('puts every depot, district and town inside Sri Lanka', () => {
    for (const at of [
      ...Object.values(DEPOT_COORDS),
      ...Object.values(DISTRICT_CENTROIDS),
      ...Object.values(TOWN_COORDS),
    ])
      expect(inSriLanka(at)).toBe(true);
  });

  it('places an outlet near its town, the same way every time, never seaward', () => {
    const outlet = {
      id: 'OUT014',
      name: 'Fresh Kadawatha',
      districtId: 'gampaha',
      depotId: 'PLG',
    };
    const at = outletPosition(outlet)!;
    expect(outletPosition(outlet)).toEqual(at);
    const [lat, lng] = TOWN_COORDS.Kadawatha;
    expect(Math.abs(at[0] - lat)).toBeLessThan(0.004);
    expect(at[1]).toBeGreaterThanOrEqual(lng);
    expect(at[1] - lng).toBeLessThan(0.004);

    // Two brands in one town don't stack.
    const style = outletPosition({
      ...outlet,
      id: 'OUT099',
      name: 'Style Kadawatha',
    })!;
    expect(style).not.toEqual(at);

    // On the south coast the nudge goes north, away from the sea.
    const galle = outletPosition({
      id: 'OUT200',
      name: 'Fresh Galle',
      districtId: 'galle',
      depotId: 'PLG',
    })!;
    expect(galle[0]).toBeGreaterThanOrEqual(TOWN_COORDS.Galle[0]);
  });

  it('falls back to the district, then the depot', () => {
    expect(
      outletPosition({
        id: 'X',
        name: 'Fresh Nowhere 3',
        districtId: 'kandy',
        depotId: 'KDY',
      }),
    ).not.toBeNull();
    expect(
      outletPosition({
        id: 'X',
        name: 'Fresh Nowhere',
        districtId: 'atlantis',
        depotId: 'PLG',
      }),
    ).not.toBeNull();
    expect(
      outletPosition({
        id: 'X',
        name: 'Fresh Nowhere',
        districtId: 'atlantis',
        depotId: 'ZZZ',
      }),
    ).toBeNull();
  });
});
