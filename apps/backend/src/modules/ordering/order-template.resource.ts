import { TEMP_CLASSES } from '@waypoint/shared';
import { ilike } from 'drizzle-orm';
import {
  contains,
  enumFilter,
  type ResourceSpec,
  textFilter,
} from '../../core/persistence/resource-spec';
import { orderTemplates } from '../../db/schema';

/** Presets as a listable resource: M1 asks for the ones that fit the open order's class. */
export const ORDER_TEMPLATE_RESOURCE = {
  name: 'order-templates',
  singular: 'order template',
  table: orderTemplates,
  queryKey: 'orderTemplates',
  pagination: 'offset',
  defaultSort: 'name',
  filters: {
    tempClass: enumFilter(orderTemplates.tempClass, TEMP_CLASSES),
    outletId: textFilter(orderTemplates.outletId),
  },
  sorts: { name: orderTemplates.name, createdAt: orderTemplates.createdAt },
  search: (q) => ilike(orderTemplates.name, contains(q)),
  includes: { lines: { lines: true } },
} satisfies ResourceSpec<typeof orderTemplates>;
