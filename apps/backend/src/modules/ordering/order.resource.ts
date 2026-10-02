import { BRANDS, ORDER_STATUSES, TEMP_CLASSES } from '@waypoint/shared';
import { ilike, or, sql } from 'drizzle-orm';
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
 *
 * `q` matches the order number or the outlet's name, both without regard to case (AC-ORD-31), so
 * 04's search box finds "kadawatha" as readily as "WF-0171".
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
    brand: enumFilter(orders.brand, BRANDS),
    depotId: textFilter(orders.depotId),
    outletId: textFilter(orders.outletId),
    districtId: textFilter(orders.districtId),
    deliveryDate: dateFilter(orders.deliveryDate),
    requestedDate: dateFilter(orders.requestedDate),
    urgent: booleanFilter(orders.urgent),
    afterCutoff: booleanFilter(orders.afterCutoff),
  },
  sorts: {
    submittedAt: orders.submittedAt,
    requestedDate: orders.requestedDate,
    deliveryDate: orders.deliveryDate,
    orderNo: orders.orderNo,
    districtId: orders.districtId,
    brand: orders.brand,
    tempClass: orders.tempClass,
    createdAt: orders.createdAt,
  },
  // The outlet subquery names its own alias rather than interpolating the
  // table: the relational query renames the table it selects from, and a
  // column reference inside the subquery would be rewritten to it.
  search: (q) =>
    or(
      ilike(orders.orderNo, contains(q)),
      sql`EXISTS (SELECT 1 FROM outlets o
            WHERE o.id = ${orders.outletId} AND o.name ILIKE ${contains(q)})`,
    ),
  // Lines come with their item, so M1's table has the SKU, name and pack label
  // without a second request.
  includes: {
    lines: { lines: { with: { item: true } } },
    outlet: { outlet: true },
  },
} satisfies ResourceSpec<typeof orders>;
