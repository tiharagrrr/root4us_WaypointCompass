import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { envelope, renderScreen, stubApi } from '@/test/api-stub'
import { Button } from '@/ui/button'
import { DispatchShell } from '../dispatch-shell'
import { DockShell } from '../dock-shell'
import { DriverShell } from '../driver-shell'
import { StoreShell } from '../store-shell'

const me = (role: string, scope: Record<string, string | null> = {}) =>
  envelope({
    id: 'u-1',
    name: 'Harini De Mel',
    email: 'harini@waypoint.lk',
    username: 'harini',
    phoneNumber: null,
    role,
    depotId: null,
    outletId: null,
    vehicleId: null,
    locale: 'en',
    permissions: [],
    _links: { self: { href: '/api/v1/me' } },
    ...scope,
  })

const stub = (role: string, scope?: Record<string, string | null>) =>
  stubApi({
    'GET /api/v1/me': () => me(role, scope),
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

/** A shell reads the matched route's handle, so it needs a data router, not just a history. */
const renderShell = (shell: ReactElement, path: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '*', element: shell }], { initialEntries: [path] })
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

const touchDensity = (container: HTMLElement) => container.querySelector('[data-density="touch"]')

describe('ROO-15 touch density', () => {
  it('ROO-15 AC-2 the dock shell asks for touch density', () => {
    stub('loader', { depotId: 'PLG' })
    const { container } = renderShell(<DockShell />, '/dock')
    expect(touchDensity(container)).not.toBeNull()
  })

  it('ROO-15 AC-2 the driver shell asks for touch density', () => {
    stub('driver', { vehicleId: 'VEH007' })
    const { container } = renderShell(<DriverShell />, '/driver')
    expect(touchDensity(container)).not.toBeNull()
  })

  it('ROO-15 AC-2 the desktop shells keep the comfortable density', () => {
    stub('store_manager', { outletId: 'OUT-FK' })
    const store = renderShell(<StoreShell />, '/store/orders/new')
    expect(touchDensity(store.container)).toBeNull()

    stub('dispatcher', { depotId: 'PLG' })
    const dispatch = renderShell(<DispatchShell />, '/dispatch')
    expect(touchDensity(dispatch.container)).toBeNull()
  })

  it('ROO-15 AC-2 a control takes its height from the density token, so touch density makes it 44 px', () => {
    const { container } = renderScreen(<Button>Release trip</Button>)
    // tokens.css: --compass-size-control is 36px, and 44px under [data-density="touch"].
    expect(container.querySelector('[data-slot="button"]')?.className).toContain('var(--compass-size-control)')
  })
})
