import { getMeGetQueryOptions, getOrdersListQueryOptions } from '@compass/api-client'
import { Navigate, type RouteObject } from 'react-router'
import { NewOrderPage } from '@/features/ordering/new-order-page'
import { STORE_OPEN_ORDERS } from '@/features/ordering/open-orders-query'
import { prefetchLoader } from '../loaders'
import { RoleArea } from '../role-area'
import type { RouteHandle } from '../route-handle'
import { ScreenPlaceholder } from '../screen-placeholder'

const handle = (title: string, eyebrow?: string): RouteHandle => (eyebrow ? { title, eyebrow } : { title })

/**
 * Store manager shell (frames M1 to M9 in specs/frontend/screens.md). Each screen is one file in
 * src/features/<module>/; replace a placeholder element with it and add its loader here.
 */
export const storeRoutes: RouteObject[] = [
  {
    path: 'store',
    element: <RoleArea allow={['store_manager']} />,
    loader: prefetchLoader((qc) => qc.prefetchQuery(getMeGetQueryOptions())),
    children: [
      {
        lazy: async () => ({ Component: (await import('../layouts/store-shell')).StoreShell }),
        children: [
          { index: true, element: <Navigate to="orders/new" replace /> },
          {
            path: 'orders/new',
            handle: handle('New order', 'New order · Fresh Kadawatha'),
            element: <NewOrderPage />,
            loader: prefetchLoader((qc) => qc.prefetchQuery(getOrdersListQueryOptions(STORE_OPEN_ORDERS))),
          },
          {
            path: 'orders',
            handle: handle('Orders'),
            lazy: async () => ({ Component: (await import('@/features/ordering/orders-page')).OrdersPage }),
          },
          {
            path: 'orders/:id/receipt',
            handle: handle('Confirm receipt'),
            element: <ScreenPlaceholder code="M5" name="Confirm receipt" node="185:11384" />,
          },
          {
            path: 'orders/:id/issue',
            handle: handle('Report issue'),
            element: <ScreenPlaceholder code="M6" name="Report issue" node="185:11543" />,
          },
          {
            path: 'deferrals',
            handle: handle('Deferrals'),
            lazy: async () => ({ Component: (await import('@/features/deferrals/deferrals-page')).DeferralsPage }),
          },
          {
            // M4 opens over M7, so a notice has a link of its own.
            path: 'deferrals/:id',
            handle: handle('Deferrals'),
            lazy: async () => ({ Component: (await import('@/features/deferrals/deferrals-page')).DeferralsPage }),
          },
          // M1's sidebar has a Receipts entry; the frames only draw the per-order screen (M5).
          { path: 'receipts', handle: handle('Receipts'), element: <ScreenPlaceholder code="M5" name="Receipts" node="185:11384" /> },
          { path: 'history', handle: handle('Order history'), element: <ScreenPlaceholder code="M8" name="Order history" node="185:11842" /> },
          { path: 'catalog', handle: handle('Item catalog'), element: <ScreenPlaceholder code="M9" name="Item catalog" node="238:825" /> },
        ],
      },
    ],
  },
]
