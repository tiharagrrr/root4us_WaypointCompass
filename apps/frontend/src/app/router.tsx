import { createBrowserRouter, type RouteObject } from 'react-router'
import { HomePage } from '@/features/home/home-page'
import { RouteError } from './route-error'
import { adminRoutes } from './routes/admin'
import { dispatchRoutes } from './routes/dispatch'
import { dockRoutes } from './routes/dock'
import { driverRoutes } from './routes/driver'
import { publicRoutes } from './routes/public'
import { storeRoutes } from './routes/store'

/**
 * Every route in the app. Each role registers its routes and loaders in src/app/routes/<role>.tsx
 * and its shell loads as that role's own chunk; screens live in src/features/<module>/
 * (specs/frontend/screens.md).
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      ...publicRoutes,
      ...adminRoutes,
      ...storeRoutes,
      ...dispatchRoutes,
      ...dockRoutes,
      ...driverRoutes,
    ],
  },
]

export const router = createBrowserRouter(routes)
