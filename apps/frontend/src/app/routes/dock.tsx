import { getMeGetQueryOptions, getTripLoadingLoadListQueryOptions, getTripLoadingReleaseChecksQueryOptions } from '@compass/api-client'
import type { RouteObject } from 'react-router'
import { LoadListPage } from '@/features/loading/load-list-page'
import { ReleaseTripPage } from '@/features/loading/release-trip-page'
import { RunsPage } from '@/features/loading/runs-page'
import { prefetchLoader } from '../loaders'
import { RoleArea } from '../role-area'

/**
 * Loader shell (frames L1 to L5 and the phone variants). The same routes serve the dock tablet
 * (1194 × 834) and a loader's phone (390); the screens pick their layout from the viewport.
 */
export const dockRoutes: RouteObject[] = [
  {
    path: 'dock',
    element: <RoleArea allow={['loader']} />,
    loader: prefetchLoader((qc) => qc.prefetchQuery(getMeGetQueryOptions())),
    children: [
      {
        lazy: async () => ({ Component: (await import('../layouts/dock-shell')).DockShell }),
        children: [
          { index: true, element: <RunsPage /> },
          {
            path: 'trips/:id',
            element: <LoadListPage />,
            loader: prefetchLoader((qc, params) =>
              params.id ? qc.prefetchQuery(getTripLoadingLoadListQueryOptions(params.id)) : Promise.resolve(null),
            ),
          },
          {
            path: 'trips/:id/release',
            element: <ReleaseTripPage />,
            loader: prefetchLoader((qc, params) =>
              params.id ? qc.prefetchQuery(getTripLoadingReleaseChecksQueryOptions(params.id)) : Promise.resolve(null),
            ),
          },
        ],
      },
    ],
  },
]
