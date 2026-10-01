import { ORDER_STATUSES, TEMP_CLASSES } from '@waypoint/shared';
import { ilike, or } from 'drizzle-orm';
import {
  booleanFilter,
  contains,
  dateFilter,
  enumFilter,
  type ResourceSpec,
  textFilter,
} from '../../core/persistence/resource-spec';
import { orders } from '../../db/schema';

/**
 * Orders as a listable resource (M1, M3, M8, 03, 04): the whitelists of filters, sorts, search and
 * includes that specs/api-conventions.md section 4 asks for. @ApiPaginated documents them, so the
 * generated client types every filter the screens use.
 */
export const ORDER_RESOURCE = {
  name: 'orders',
  singular: 'order',
  table: orders,
  queryKey: 'orders',
  pagination: 'offset',
  defaultSort: '-submittedAt',
  filters: {
    status: enumFilter(orders.status, ORDER_STATUSES),
    tempClass: enumFilter(orders.tempClass, TEMP_CLASSES),
    depotId: textFilter(orders.depotId),
    outletId: textFilter(orders.outletId),
    districtId: textFilter(orders.districtId),
    deliveryDate: dateFilter(orders.deliveryDate),
    requestedDate: dateFilter(orders.requestedDate),
    urgent: booleanFilter(orders.urgent),
  },
  sorts: {
    submittedAt: orders.submittedAt,
    requestedDate: orders.requestedDate,
    deliveryDate: orders.deliveryDate,
    orderNo: orders.orderNo,
    districtId: orders.districtId,
    tempClass: orders.tempClass,
  },
  search: (q) => or(ilike(orders.orderNo, contains(q))),
  includes: { lines: { lines: true }, outlet: { outlet: true } },
} satisfies ResourceSpec<typeof orders>;
