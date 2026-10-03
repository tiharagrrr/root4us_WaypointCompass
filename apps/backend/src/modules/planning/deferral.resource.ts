import { DEFERRAL_STATUSES, STORE_RESPONSES } from '@waypoint/shared';
import {
  booleanFilter,
  dateFilter,
  enumFilter,
  type ResourceSpec,
  uuidFilter,
} from '../../core/persistence/resource-spec';
import { deferrals } from '../../db/schema';

/**
 * Deferrals as a listable resource (23, M7): the filters and sorts
 * specs/api-conventions.md section 4 asks for. The newest first, so M7 opens
 * on what the store heard about last.
 */
export const DEFERRAL_RESOURCE = {
  name: 'deferrals',
  table: deferrals,
  queryKey: 'deferrals',
  pagination: 'offset',
  defaultSort: '-createdAt',
  filters: {
    status: enumFilter(deferrals.status, DEFERRAL_STATUSES),
    storeResponse: enumFilter(deferrals.storeResponse, STORE_RESPONSES),
    source: enumFilter(deferrals.source),
    planId: uuidFilter(deferrals.planId),
    orderId: uuidFilter(deferrals.orderId),
    fromDate: dateFilter(deferrals.fromDate),
    toDate: dateFilter(deferrals.toDate),
    repeatSkip: booleanFilter(deferrals.repeatSkip),
  },
  sorts: {
    createdAt: deferrals.createdAt,
    fromDate: deferrals.fromDate,
    toDate: deferrals.toDate,
  },
} satisfies ResourceSpec<typeof deferrals>;
