import { getMeGetQueryOptions } from '@compass/api-client'
import type { RouteObject } from 'react-router'
import { prefetchLoader } from '../loaders'
import { RoleArea } from '../role-area'
import { ScreenPlaceholder } from '../screen-placeholder'

/**
 * Driver shell (frames D1 to D14), phone 390 × 844. Every screen after D1 reads from Dexie and
 * every write goes through the offline outbox, so these routes must work with no signal.
 */
export const driverRoutes: RouteObject[] = [
  {
    path: 'driver',
    element: <RoleArea allow={['driver']} />,
    loader: prefetchLoader((qc) => qc.prefetchQuery(getMeGetQueryOptions())),
    children: [
      {
        lazy: async () => ({ Component: (await import('../layouts/driver-shell')).DriverShell }),
        children: [
          {
            index: true,
            lazy: async () => ({
              Component: (await import('@/features/execution/todays-trip-page')).TodaysTripPage,
            }),
          },
          {
            path: 'stops/:id',
            handle: { tabBar: false },
            lazy: async () => ({
              Component: (await import('@/features/execution/next-stop-page')).NextStopPage,
            }),
          },
          {
            path: 'stops/:id/record',
            handle: { tabBar: false },
            lazy: async () => ({
              Component: (await import('@/features/execution/record-stop-page')).RecordStopPage,
            }),
          },
          {
            path: 'stops/:id/exception',
            handle: { tabBar: false },
            lazy: async () => ({
              Component: (await import('@/features/execution/exception-page')).ExceptionPage,
            }),
          },
          { path: 'trips', element: <ScreenPlaceholder code="D10" name="Trips" node="245:828" /> },
          { path: 'trips/:id', element: <ScreenPlaceholder code="D11" name="Past trip" node="245:1009" /> },
          {
            // D7, the end of the round (ROO-62).
            path: 'trips/:id/done',
            lazy: async () => ({ Component: (await import('@/features/execution/trip-complete-page')).TripCompletePage }),
          },
          {
            // D12 with D13's sign-out rule: it waits for the outbox to drain.
            path: 'account',
            lazy: async () => ({ Component: (await import('@/features/identity/driver-account-page')).DriverAccountPage }),
          },
        ],
      },
    ],
  },
]
