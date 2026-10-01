import {
  getClockGetQueryOptions,
  getInvitationsListQueryOptions,
  getMeGetQueryOptions,
  getSettingsListQueryOptions,
  getUsersListQueryOptions,
} from '@compass/api-client'
import { SettingsPage } from '@/features/identity/settings-page'
import { UsersPage } from '@/features/identity/users-page'
import { Navigate, type RouteObject } from 'react-router'
import { AdminShell } from '../layouts/admin-shell'
import { prefetchLoader } from '../loaders'
import type { RouteHandle } from '../route-handle'
import { ScreenPlaceholder } from '../screen-placeholder'

const handle = (title: string): RouteHandle => ({ title })

/**
 * Admin shell (frames A0 to A6 in specs/frontend/screens.md). Each screen is one file in
 * src/features/<module>/; replace a placeholder element with it and add its loader here.
 */
export const adminRoutes: RouteObject[] = [
  {
    path: 'admin',
    element: <AdminShell />,
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
      { path: 'outlets', handle: handle('Outlets'), element: <ScreenPlaceholder code="A3" name="Outlets" node="185:9392" /> },
      { path: 'depots', handle: handle('Depots'), element: <ScreenPlaceholder code="A4" name="Depots" node="185:9769" /> },
      { path: 'vehicles', handle: handle('Vehicles'), element: <ScreenPlaceholder code="A5" name="Vehicles" node="185:9904" /> },
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
