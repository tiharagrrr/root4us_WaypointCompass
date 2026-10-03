import { DEFERRAL_STATUSES, STORE_RESPONSES } from '@waypoint/shared';
import { sql, type SQL } from 'drizzle-orm';
import {
  booleanFilter,
  contains,
  dateFilter,
  enumFilter,
  type ResourceSpec,
  textFilter,
  uuidFilter,
} from '../../core/persistence/resource-spec';
import { deferrals } from '../../db/schema';

/**
 * A condition on the deferral's order `o` and its outlet `ol`, as an EXISTS
 * subquery. Raw aliases, because the relational query renders every drizzle
 * column under the deferrals alias.
 */
const viaPlan = (condition: SQL): SQL =>
  sql`exists (select 1 from plans pl where pl.id = ${deferrals.planId} and ${condition})`;

const viaOrder = (condition: SQL): SQL =>
  sql`exists (select 1 from orders o join outlets ol on ol.id = o."outletId" where o.id = ${deferrals.orderId} and ${condition})`;

/**
 * Deferrals as a listable resource (23, M7): the filters and sorts
 * specs/api-conventions.md section 4 asks for. The newest first, so M7 opens
 * on what the store heard about last. 23 also filters by reason and by outlet
 * (its history panel), and searches the order number and outlet name.
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
    reasonCode: textFilter(deferrals.reasonCode),
    outletId: { ...textFilter(sql`o."outletId"`), wrap: viaOrder },
    // 23 follows the dispatcher's depot switch; the scope still applies on top.
    depotId: { ...textFilter(sql`pl."depotId"`), wrap: viaPlan },
  },
  search: (q) =>
    viaOrder(
      sql`(o."orderNo" ilike ${contains(q)} or ol.name ilike ${contains(q)})`,
    ),
  sorts: {
    createdAt: deferrals.createdAt,
    fromDate: deferrals.fromDate,
    toDate: deferrals.toDate,
  },
} satisfies ResourceSpec<typeof deferrals>;
