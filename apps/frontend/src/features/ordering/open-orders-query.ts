import type { OrdersListParams } from '@compass/api-client'

/**
 * The day's orders for the store: a draft, or one already sent and still editable until the
 * cutoff. M1 and the store shell ask for exactly this, so they share one request.
 */
export const STORE_OPEN_ORDERS: OrdersListParams = {
  'filter[status]': 'DRAFT,SUBMITTED',
  sort: 'requestedDate,tempClass',
  limit: 10,
}
