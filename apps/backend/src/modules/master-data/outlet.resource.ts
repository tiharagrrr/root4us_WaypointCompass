import { BRANDS, DOCK_TYPES, PARKING_CONSTRAINTS } from '@waypoint/shared';
import { ilike, or, sql } from 'drizzle-orm';
import {
  contains,
  enumFilter,
  INVALID,
  type FilterSpec,
  type ResourceSpec,
  textFilter,
} from '../../core/persistence/resource-spec';
import { outlets } from '../../db/schema';

/**
 * Whether anyone manages the outlet: an active store manager linked to it
 * (AC-MD-05). A read of identity's `users` table, not of its module: A3 needs
 * the flag beside each row, and master-data imports only core and audit.
 */
const hasManager: FilterSpec = {
  column: sql`exists (select 1 from users u where u."outletId" = ${outlets.id} and u.role = 'store_manager' and u.banned is not true)`,
  ops: ['eq'],
  parse: (raw) => (raw === 'true' ? true : raw === 'false' ? false : INVALID),
  format: 'true or false',
};

/**
 * Outlets as a listable resource (A3): filter by brand, district, depot, dock
 * type, parking and whether anyone manages them; search by name or id.
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
    hasManager,
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
