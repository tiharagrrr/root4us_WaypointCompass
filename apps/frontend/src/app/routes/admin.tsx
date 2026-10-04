import {
  getClockGetQueryOptions,
  getDepotsListQueryOptions,
  getInvitationsListQueryOptions,
  getMeGetQueryOptions,
  getOutletsListQueryOptions,
  getSettingsListQueryOptions,
  getUsersListQueryOptions,
  getVehiclesListQueryOptions,
} from '@compass/api-client'
import { VehiclesPage } from '@/features/fleet/vehicles-page'
import { SettingsPage } from '@/features/identity/settings-page'
import { UsersPage } from '@/features/identity/users-page'
import { DepotsPage } from '@/features/master-data/depots-page'
import { OutletsPage } from '@/features/master-data/outlets-page'
import { Navigate, type RouteObject } from 'react-router'
import { AdminShell } from '../layouts/admin-shell'
import { prefetchLoader } from '../loaders'
import { RoleArea } from '../role-area'
import type { RouteHandle } from '../route-handle'

const handle = (title: string): RouteHandle => ({ title })

/**
 * Admin shell (frames A0 to A6 in specs/frontend/screens.md). Each screen is one file in
 * src/features/<module>/; replace a placeholder element with it and add its loader here.
 */
export const adminRoutes: RouteObject[] = [
  {
    path: 'admin',
    element: (
      <RoleArea allow={['admin']}>
        <AdminShell />
      </RoleArea>
    ),
    loader: prefetchLoader((qc) => qc.prefetchQuery(getMeGetQueryOptions())),
    children: [
      { index: true, element: <Navigate to="users" replace /> },
      {
        path: 'users',
        handle: handle('Users'),
        element: <UsersPage />,
        loader: prefetchLoader((qc) =>
          Promise.all([
            qc.prefetchQuery(getUsersListQueryOptions({ limit: 10, offset: 0, sort: 'name' })),
            qc.prefetchQuery(getInvitationsListQueryOptions({ limit: 100, sort: '-createdAt' })),
          ]),
        ),
      },
      {
        path: 'outlets',
        handle: handle('Outlets'),
        element: <OutletsPage />,
        loader: prefetchLoader((qc) =>
          Promise.all([
            qc.prefetchQuery(getOutletsListQueryOptions({ limit: 10, offset: 0, sort: 'name' })),
            qc.prefetchQuery(getDepotsListQueryOptions()),
          ]),
        ),
      },
      {
        path: 'depots',
        handle: handle('Depots'),
        element: <DepotsPage />,
        loader: prefetchLoader((qc) => qc.prefetchQuery(getDepotsListQueryOptions())),
      },
      {
        path: 'vehicles',
        handle: handle('Vehicles'),
        element: <VehiclesPage />,
        loader: prefetchLoader((qc) =>
          Promise.all([
            qc.prefetchQuery(getVehiclesListQueryOptions({ limit: 10, offset: 0, sort: 'code' })),
            qc.prefetchQuery(getDepotsListQueryOptions()),
          ]),
        ),
      },
      {
        path: 'settings',
        handle: handle('Settings'),
        element: <SettingsPage />,
        loader: prefetchLoader((qc) => Promise.all([qc.prefetchQuery(getSettingsListQueryOptions()), qc.prefetchQuery(getClockGetQueryOptions())])),
      },
      // Development only: the src/ui components inside the admin shell.
      ...(import.meta.env.DEV
        ? [
            {
              path: 'dev/ui',
              handle: handle('Components'),
              lazy: async () => ({ Component: (await import('@/features/dev/ui-gallery')).UiGallery }),
            },
          ]
        : []),
    ],
  },
]
