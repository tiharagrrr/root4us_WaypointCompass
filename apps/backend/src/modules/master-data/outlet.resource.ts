import { BRANDS, DOCK_TYPES, PARKING_CONSTRAINTS } from '@waypoint/shared';
import { ilike, or } from 'drizzle-orm';
import {
  contains,
  enumFilter,
  type ResourceSpec,
  textFilter,
} from '../../core/persistence/resource-spec';
import { outlets } from '../../db/schema';

/**
 * Outlets as a listable resource (A3): filter by brand, district, depot, dock
 * type and parking; search by name or id.
 */
export const OUTLET_RESOURCE = {
  name: 'outlets',
  singular: 'outlet',
  table: outlets,
  queryKey: 'outlets',
  pagination: 'offset',
  defaultSort: 'name',
  filters: {
    brand: enumFilter(outlets.brand, BRANDS),
    districtId: textFilter(outlets.districtId),
    depotId: textFilter(outlets.depotId),
    dockType: enumFilter(outlets.dockType, DOCK_TYPES),
    parkingConstraint: enumFilter(
      outlets.parkingConstraint,
      PARKING_CONSTRAINTS,
    ),
  },
  sorts: {
    name: outlets.name,
    brand: outlets.brand,
    districtId: outlets.districtId,
    depotId: outlets.depotId,
  },
  search: (q) =>
    or(ilike(outlets.name, contains(q)), ilike(outlets.id, contains(q))),
} satisfies ResourceSpec<typeof outlets>;
