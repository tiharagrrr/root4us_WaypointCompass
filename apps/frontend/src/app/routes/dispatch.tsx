import { getDeferralReasonsListQueryOptions, getMeGetQueryOptions } from '@compass/api-client'
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
          {
            index: true,
            handle: handle('Dashboard'),
            // 01 is shared: alerts builds the banner and the exception panel (ROO-50).
            lazy: async () => ({ Component: (await import('@/features/alerts/dashboard-page')).DashboardPage }),
          },
          {
            // 03 (ROO-35).
            path: 'orders',
            handle: handle('Order queue'),
            lazy: async () => ({ Component: (await import('@/features/ordering/order-queue-page')).OrderQueuePage }),
          },
          { path: 'past-orders', handle: handle('Past orders'), element: <ScreenPlaceholder code="04" name="Past orders" node="488:8916" /> },
          {
            path: 'plan',
            handle: handle('Plan'),
            lazy: async () => ({ Component: (await import('@/features/planning/plan-page')).PlanIndexRedirect }),
          },
          {
            // 05 and 09: one route, empty until the day has trips (ROO-30).
            path: 'plan/:date',
            handle: handle('Plan'),
            lazy: async () => ({ Component: (await import('@/features/planning/plan-page')).PlanPage }),
          },
          {
            // 14, step 2 (ROO-41).
            path: 'plan/:date/confirm',
            handle: handle('Plan'),
            lazy: async () => ({ Component: (await import('@/features/planning/confirm-page')).ConfirmPage }),
          },
          {
            // 15 and 16, step 3 (ROO-41).
            path: 'plan/:date/unplanned',
            handle: handle('Unplanned orders'),
            lazy: async () => ({ Component: (await import('@/features/planning/unplanned-page')).UnplannedPage }),
          },
          {
            // 17 and 18, step 4 (ROO-41).
            path: 'plan/:date/publish',
            handle: handle('Review and publish'),
            lazy: async () => ({ Component: (await import('@/features/planning/publish-page')).PublishPage }),
          },
          { path: 'plan-ahead', handle: handle('Plan ahead'), element: <ScreenPlaceholder code="12" name="Plan ahead" node="290:2387" /> },
          {
            path: 'plan-ahead/:date',
            handle: handle('Plan ahead'),
            element: <ScreenPlaceholder code="13" name="Plan ahead · day" node="289:2797" />,
          },
          {
            path: 'tracking',
            handle: handle('Tracking'),
            // 19 is shared: alerts builds the alerts column (ROO-50).
            lazy: async () => ({ Component: (await import('@/features/alerts/tracking-page')).TrackingPage }),
          },
          {
            path: 'trips/:id',
            handle: handle('Trip details'),
            // 19a is shared: alerts builds the trip's chips and its alerts (ROO-50).
            lazy: async () => ({ Component: (await import('@/features/alerts/trip-details-page')).TripDetailsPage }),
          },
          {
            path: 'end-of-day',
            handle: handle('End of day'),
            element: <ScreenPlaceholder code="21" name="End-of-day summary" node="185:18295" />,
          },
          { path: 'forecast', handle: handle('Forecast'), element: <ScreenPlaceholder code="22" name="Forecast" node="185:18562" /> },
          {
            // 23 (ROO-43).
            path: 'deferrals',
            handle: handle('Deferrals'),
            loader: prefetchLoader((qc) => qc.prefetchQuery(getDeferralReasonsListQueryOptions())),
            lazy: async () => ({ Component: (await import('@/features/deferrals/dispatch-deferrals-page')).DispatchDeferralsPage }),
          },
        ],
      },
    ],
  },
]
