import { getMeGetQueryOptions, getOrdersListQueryOptions } from '@compass/api-client'
import { Navigate, type RouteObject } from 'react-router'
import { NewOrderPage } from '@/features/ordering/new-order-page'
import { STORE_OPEN_ORDERS } from '@/features/ordering/open-orders-query'
import { StoreShell } from '../layouts/store-shell'
import { prefetchLoader } from '../loaders'
import type { RouteHandle } from '../route-handle'
import { ScreenPlaceholder } from '../screen-placeholder'

const handle = (title: string): RouteHandle => ({ title })

/**
 * Store manager shell (frames M1 to M9 in specs/frontend/screens.md). Each screen is one file in
 * src/features/<module>/; replace a placeholder element with it and add its loader here.
 */
export const storeRoutes: RouteObject[] = [
  {
    path: 'store',
    element: <StoreShell />,
    loader: prefetchLoader((qc) => qc.prefetchQuery(getMeGetQueryOptions())),
    children: [
      { index: true, element: <Navigate to="orders/new" replace /> },
      {
        path: 'orders/new',
        handle: handle('New order'),
        element: <NewOrderPage />,
        loader: prefetchLoader((qc) => qc.prefetchQuery(getOrdersListQueryOptions(STORE_OPEN_ORDERS))),
      },
      { path: 'orders', handle: handle('Orders'), element: <ScreenPlaceholder code="M3" name="Orders" node="185:10924" /> },
      { path: 'deferrals', handle: handle('Deferrals'), element: <ScreenPlaceholder code="M7" name="Deferrals" node="185:11685" /> },
      { path: 'deferrals/:id', handle: handle('Deferral notice'), element: <ScreenPlaceholder code="M4" name="Deferral notice" node="185:11128" /> },
      { path: 'receipts', handle: handle('Receipts'), element: <ScreenPlaceholder code="M5" name="Receipts" node="185:11384" /> },
      { path: 'catalog', handle: handle('Item catalog'), element: <ScreenPlaceholder code="M9" name="Item catalog" node="238:825" /> },
      { path: 'history', handle: handle('Order history'), element: <ScreenPlaceholder code="M8" name="Order history" node="185:11842" /> },
    ],
  },
]
