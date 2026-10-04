import 'fake-indexeddb/auto'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserRole } from '@waypoint/shared/domain'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { envelope, page, stubApi } from '@/test/api-stub'
import { queryClient } from '../query-client'
import { routes } from '../router'

const signIn = vi.hoisted(() => ({ email: vi.fn(), username: vi.fn() }))
vi.mock('@/features/identity/auth-client', () => ({ authClient: { signIn } }))

interface Scope {
  depotId?: string | null
  outletId?: string | null
  vehicleId?: string | null
}

const me = (role: UserRole, scope: Scope = {}) =>
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

const clock = () =>
  envelope({
    mode: 'real',
    now: '2026-10-01T15:12:00+05:30',
    realNow: '2026-10-01T15:12:00+05:30',
    at: null,
    offsetMs: null,
    demoMode: true,
    shifted: false,
    _links: { self: { href: '/api/v1/clock' } },
  })

/** The API's answer with no session cookie: A0 shows its form only while this is what /me says. */
const unauthenticated = () =>
  new Response(JSON.stringify({ code: 'UNAUTHENTICATED', status: 401, title: 'Sign in to continue' }), {
    status: 401,
    headers: { 'content-type': 'application/problem+json' },
  })

/** Whether the stubbed API has a session; sign-in turns it on, like the real cookie would. */
const session = { on: false }

const stub = (role: UserRole, scope?: Scope, signedIn = false) => {
  session.on = signedIn
  return stubApi({
    'GET /api/v1/me': () => (session.on ? me(role, scope) : unauthenticated()),
    'POST /api/v1/me/devices': () => envelope({ id: 'd-1', platform: 'WEB', isDockDevice: false, depotId: null }),
    'GET /api/v1/clock': () => clock(),
    'GET /api/v1/users': () => page([]),
    'GET /api/v1/invitations': () => page([]),
  })
}

/**
 * The shells and their first screens load lazily, and the first import of each compiles in the
 * test run; with every suite running at once that can pass the default 1 s, so wait longer.
 */
const LAZY = { timeout: 5_000 }

const renderApp = (initialEntry = '/sign-in') => {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const signInAs = async () => {
  signIn.email.mockImplementation(async () => {
    session.on = true
    return { data: { user: { id: 'u-1' } }, error: null }
  })
  await userEvent.type(await screen.findByLabelText('Email or username'), 'harini@waypoint.lk')
  await userEvent.type(screen.getByLabelText('Password'), 'correct-horse')
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

/** One row per role: where sign-in sends them, and what their own shell shows when they land. */
const ROLES: readonly (readonly [UserRole, Scope, string, { readonly role: string; readonly name: string }])[] = [
  ['admin', {}, '/admin/users', { role: 'link', name: 'Users' }],
  ['dispatcher', { depotId: 'PLG' }, '/dispatch', { role: 'link', name: 'Order queue' }],
  ['store_manager', { outletId: 'OUT-FK' }, '/store/orders/new', { role: 'link', name: 'New order' }],
  ['loader', { depotId: 'PLG' }, '/dock', { role: 'button', name: 'Switch user' }],
  ['driver', { vehicleId: 'VEH007' }, '/driver', { role: 'link', name: 'Today' }],
]

describe('ROO-15 role landing', () => {
  beforeEach(() => queryClient.clear())
  afterEach(() => vi.clearAllMocks())

  it.each(ROLES)('ROO-15 AC-1 a %s lands on their own shell after sign-in', async (role, scope, home, landmark) => {
    stub(role, scope)
    const router = renderApp()

    await signInAs()

    expect(await screen.findByRole(landmark.role, { name: landmark.name }, LAZY)).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe(home))
  })

  it('ROO-15 a route outside the role area redirects to the role home', async () => {
    stub('dispatcher', { depotId: 'PLG' }, true)
    const router = renderApp('/store/orders')

    await waitFor(() => expect(router.state.location.pathname).toBe('/dispatch'), LAZY)
    expect(await screen.findByRole('link', { name: 'Order queue' }, LAZY)).toBeInTheDocument()
  })
})
