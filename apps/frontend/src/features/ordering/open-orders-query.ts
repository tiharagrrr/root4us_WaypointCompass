import type { OrdersListParams } from '@compass/api-client'

/**
 * The store's open orders, for every day it has one: a draft, or one already sent and still
 * editable until the cutoff. M1 and the store shell ask for exactly this, so they share one
 * request. A store can order up to two weeks ahead, two classes a day, so 50 holds them all.
 */
export const STORE_OPEN_ORDERS: OrdersListParams = {
  'filter[status]': 'DRAFT,SUBMITTED',
  sort: 'requestedDate,tempClass',
  limit: 50,
}
