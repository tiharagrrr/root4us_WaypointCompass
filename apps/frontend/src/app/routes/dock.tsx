import { getMeGetQueryOptions } from '@compass/api-client'
import type { RouteObject } from 'react-router'
import { prefetchLoader } from '../loaders'
import { RoleArea } from '../role-area'
import { ScreenPlaceholder } from '../screen-placeholder'

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
          { index: true, element: <ScreenPlaceholder code="L2m-a" name="Runs" node="254:1306" /> },
          { path: 'trips/:id', element: <ScreenPlaceholder code="L2" name="Loading list" node="185:19377" /> },
          { path: 'trips/:id/release', element: <ScreenPlaceholder code="L4" name="Release trip" node="185:19748" /> },
        ],
      },
    ],
  },
]
