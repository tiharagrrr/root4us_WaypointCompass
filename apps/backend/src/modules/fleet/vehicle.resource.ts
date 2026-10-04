import {
  VEHICLE_STATUSES,
  VEHICLE_TEMPS,
  VEHICLE_TYPES,
} from '@waypoint/shared';
import { ilike, or } from 'drizzle-orm';
import {
  contains,
  enumFilter,
  type ResourceSpec,
  textFilter,
} from '../../core/persistence/resource-spec';
import { vehicles } from '../../db/schema';

/**
 * Vehicles as a listable resource (A5): filter by depot, status, type and
 * temperature; search by code, registration or id. Sorted by code, the name
 * the dispatcher and the dock use ("REF-07").
 */
export const VEHICLE_RESOURCE = {
  name: 'vehicles',
  singular: 'vehicle',
  table: vehicles,
  queryKey: 'vehicles',
  pagination: 'offset',
  defaultSort: 'code',
  filters: {
    depotId: textFilter(vehicles.depotId),
    status: enumFilter(vehicles.status, VEHICLE_STATUSES),
    type: enumFilter(vehicles.type, VEHICLE_TYPES),
    temp: enumFilter(vehicles.temp, VEHICLE_TEMPS),
  },
  sorts: {
    code: vehicles.code,
    status: vehicles.status,
    depotId: vehicles.depotId,
    weightCapKg: vehicles.weightCapKg,
    volumeCapM3: vehicles.volumeCapM3,
  },
  search: (q) =>
    or(
      ilike(vehicles.code, contains(q)),
      ilike(vehicles.registrationNo, contains(q)),
      ilike(vehicles.id, contains(q)),
    ),
} satisfies ResourceSpec<typeof vehicles>;
