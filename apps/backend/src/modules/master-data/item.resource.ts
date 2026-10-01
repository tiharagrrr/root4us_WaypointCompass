import { BRANDS, TEMP_CLASSES } from '@waypoint/shared';
import { ilike, or } from 'drizzle-orm';
import {
  booleanFilter,
  contains,
  enumFilter,
  type ResourceSpec,
  textFilter,
} from '../../core/persistence/resource-spec';
import { items } from '../../db/schema';

/**
 * The catalog as a listable resource: M1a's item picker filters it by class, M9 shows all of it.
 * Fresh carries 50 items, 32 ambient and 18 chilled, so one page of 100 holds a brand's range.
 */
export const ITEM_RESOURCE = {
  name: 'items',
  singular: 'item',
  table: items,
  queryKey: 'items',
  pagination: 'offset',
  defaultSort: 'name',
  maxLimit: 200,
  filters: {
    brand: enumFilter(items.brand, BRANDS),
    tempClass: enumFilter(items.tempClass, TEMP_CLASSES),
    category: textFilter(items.category),
    active: booleanFilter(items.active),
    fragile: booleanFilter(items.fragile),
  },
  sorts: {
    name: items.name,
    sku: items.sku,
    category: items.category,
    unitWeightKg: items.unitWeightKg,
  },
  search: (q) =>
    or(ilike(items.name, contains(q)), ilike(items.sku, contains(q))),
} satisfies ResourceSpec<typeof items>;
