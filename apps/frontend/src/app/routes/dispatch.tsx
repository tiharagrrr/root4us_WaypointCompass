import { getMeGetQueryOptions } from '@compass/api-client'
import type { RouteObject } from 'react-router'
import { prefetchLoader } from '../loaders'
import { RoleArea } from '../role-area'
import type { RouteHandle } from '../route-handle'
import { ScreenPlaceholder } from '../screen-placeholder'

const handle = (title: string): RouteHandle => ({ title })

/**
 * Dispatcher shell (frames 01 to 23 in specs/frontend/screens.md): the order queue, the four-step
 * planning flow, tracking, the end of the day, the forecast and deferrals.
 */
export const dispatchRoutes: RouteObject[] = [
  {
    path: 'dispatch',
    element: <RoleArea allow={['dispatcher']} />,
    loader: prefetchLoader((qc) => qc.prefetchQuery(getMeGetQueryOptions())),
    children: [
      {
        lazy: async () => ({ Component: (await import('../layouts/dispatch-shell')).DispatchShell }),
        children: [
          { index: true, handle: handle('Dashboard'), element: <ScreenPlaceholder code="01" name="Dashboard" node="488:8577" /> },
          { path: 'orders', handle: handle('Order queue'), element: <ScreenPlaceholder code="03" name="Order queue" node="185:12856" /> },
          { path: 'past-orders', handle: handle('Past orders'), element: <ScreenPlaceholder code="04" name="Past orders" node="488:8916" /> },
          { path: 'plan', handle: handle('Plan'), element: <ScreenPlaceholder code="05" name="Plan" node="265:2134" /> },
          { path: 'plan/:date', handle: handle('Plan'), element: <ScreenPlaceholder code="09" name="Plan · vehicles" node="268:2245" /> },
          { path: 'plan-ahead', handle: handle('Plan ahead'), element: <ScreenPlaceholder code="12" name="Plan ahead" node="290:2387" /> },
          {
            path: 'plan-ahead/:date',
            handle: handle('Plan ahead'),
            element: <ScreenPlaceholder code="13" name="Plan ahead · day" node="289:2797" />,
          },
          { path: 'tracking', handle: handle('Tracking'), element: <ScreenPlaceholder code="19" name="Tracking" node="185:17224" /> },
          { path: 'trips/:id', handle: handle('Trip details'), element: <ScreenPlaceholder code="19a" name="Trip details" node="464:1966" /> },
          {
            path: 'end-of-day',
            handle: handle('End of day'),
            element: <ScreenPlaceholder code="21" name="End-of-day summary" node="185:18295" />,
          },
          { path: 'forecast', handle: handle('Forecast'), element: <ScreenPlaceholder code="22" name="Forecast" node="185:18562" /> },
          { path: 'deferrals', handle: handle('Deferrals'), element: <ScreenPlaceholder code="23" name="Deferrals" node="185:18890" /> },
        ],
      },
    ],
  },
]
