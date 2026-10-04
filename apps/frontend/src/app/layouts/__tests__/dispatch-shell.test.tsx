import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatchRoutes } from '@/app/routes/dispatch'
import { envelope, stubApi } from '@/test/api-stub'
import { DispatchShell } from '../dispatch-shell'

afterEach(() => vi.unstubAllGlobals())

describe('DispatchShell', () => {
  it('ROO-55 the dispatcher sidebar links to a simulation route that exists', async () => {
    stubApi({
      'GET /api/v1/me': () =>
        envelope({
          id: 'u-1',
          name: 'Tihara Egodage',
          email: 'tihara@waypoint.lk',
          username: 'tihara',
          phoneNumber: null,
          role: 'dispatcher',
          depotId: 'PLG',
          outletId: null,
          vehicleId: null,
          locale: 'en',
          permissions: [],
          _links: { self: { href: '/api/v1/me' } },
        }),
      'GET /api/v1/clock': () =>
        envelope({
          mode: 'real',
          now: '2026-10-01T15:12:00+05:30',
          realNow: '2026-10-01T15:12:00+05:30',
          at: null,
          offsetMs: null,
          demoMode: true,
          shifted: false,
          _links: { self: { href: '/api/v1/clock' } },
        }),
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const router = createMemoryRouter([{ path: '*', element: <DispatchShell /> }], { initialEntries: ['/dispatch'] })
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('link', { name: 'Simulation' })).toHaveAttribute('href', '/dispatch/simulation')
    const screens = dispatchRoutes[0]?.children?.[0]?.children ?? []
    expect(screens.some((route) => route.path === 'simulation')).toBe(true)
  })
})
