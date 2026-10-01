import { getMeGetQueryOptions } from '@compass/api-client'
import { Navigate, type RouteObject } from 'react-router'
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
            element: <ScreenPlaceholder code="M1" name="New order" node="185:10376" />,
          },
          { path: 'orders', handle: handle('Orders'), element: <ScreenPlaceholder code="M3" name="Orders" node="185:10924" /> },
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
          { path: 'deferrals', handle: handle('Deferrals'), element: <ScreenPlaceholder code="M7" name="Deferrals" node="185:11685" /> },
          {
            path: 'deferrals/:id',
            handle: handle('Deferral notice'),
            element: <ScreenPlaceholder code="M4" name="Deferral notice" node="185:11128" />,
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
