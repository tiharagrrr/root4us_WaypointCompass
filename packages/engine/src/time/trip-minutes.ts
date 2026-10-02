import type { Brand, DockType } from '@waypoint/shared/domain';
import { EngineInputError } from '../errors';
import type { AllowanceTable, EngineDistrict } from '../types';

export interface TripMinutesInput {
  district: Pick<EngineDistrict, 'depotToDistrictMin' | 'interStopMin'>;
  brand: Brand;
  /** The dock type of each stop's outlet, one per order. */
  dockTypes: readonly DockType[];
  allowances: AllowanceTable;
}

export function allowanceKey(brand: Brand, dockType: DockType): string {
  return `${brand}:${dockType}`;
}

export function allowanceMinutes(
  allowances: AllowanceTable,
  brand: Brand,
  dockType: DockType,
): number {
  const key = allowanceKey(brand, dockType);
  const minutes = allowances[key];
  if (minutes === undefined) {
    throw new EngineInputError({
      code: 'MISSING_ALLOWANCE',
      field: 'input.allowances',
      value: key,
      reason: 'has no service allowance for this brand and dock type',
    });
  }
  return minutes;
}

/**
 * Trip minutes: outbound travel once, inter-stop travel between stops, and handling per
 * stop. The return journey is not counted. Stop order does not matter; a trip with no stops is 0.
 */
export function tripMinutes({ district, brand, dockTypes, allowances }: TripMinutesInput): number {
  const stops = dockTypes.length;
  if (stops === 0) return 0;
  let handling = 0;
  for (const dockType of dockTypes) handling += allowanceMinutes(allowances, brand, dockType);
  return district.depotToDistrictMin + district.interStopMin * (stops - 1) + handling;
}
