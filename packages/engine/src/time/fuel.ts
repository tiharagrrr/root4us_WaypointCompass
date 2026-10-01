import type { EngineDistrict } from '../types';

/** Fuel counts the return leg; trip minutes do not. A trip with no stops uses none. */
export function tripKm(
  district: Pick<EngineDistrict, 'depotToDistrictKm' | 'interStopKm'>,
  stops: number,
): number {
  if (stops === 0) return 0;
  return 2 * district.depotToDistrictKm + district.interStopKm * (stops - 1);
}

export function tripLitres(km: number, kmPerL: number): number {
  return km / kmPerL;
}
