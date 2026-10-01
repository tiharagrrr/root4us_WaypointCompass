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
          { index: true, element: <ScreenPlaceholder code="D1" name="Today's trip" node="185:19938" /> },
          { path: 'stops/:id', element: <ScreenPlaceholder code="D3" name="Next stop" node="185:20107" /> },
          { path: 'stops/:id/record', element: <ScreenPlaceholder code="D4" name="Record stop" node="185:20174" /> },
          { path: 'stops/:id/exception', element: <ScreenPlaceholder code="D5" name="Exception" node="185:20240" /> },
          { path: 'trips', element: <ScreenPlaceholder code="D10" name="Trips" node="245:828" /> },
          { path: 'trips/:id', element: <ScreenPlaceholder code="D11" name="Past trip" node="245:1009" /> },
          { path: 'trips/:id/done', element: <ScreenPlaceholder code="D7" name="Trip complete" node="185:20391" /> },
          { path: 'account', element: <ScreenPlaceholder code="D12" name="Account" node="246:874" /> },
        ],
      },
    ],
  },
]
