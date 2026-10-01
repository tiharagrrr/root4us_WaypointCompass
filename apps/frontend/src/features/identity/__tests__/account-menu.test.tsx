import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, renderScreen, stubApi } from '@/test/api-stub'
import { AccountMenu } from '../account-menu'

const auth = vi.hoisted(() => ({ signOut: vi.fn(), $fetch: vi.fn() }))
vi.mock('../auth-client', () => ({ authClient: auth }))

const me = {
  id: 'u-nimesha',
  name: 'Nimesha Periyapperuma',
  email: 'nimesha.p@waypoint.lk',
  role: 'store_manager',
  depotId: null,
  outletId: 'OUT014',
  vehicleId: null,
  locale: 'en',
  permissions: [],
  _links: {},
}

const cast = {
  users: [
    { ...me, scopeNames: { depot: null, outlet: 'Fresh Kadawatha', vehicle: null } },
    {
      id: 'u-tihara',
      name: 'Tihara Egodage',
      email: 'tihara.e@waypoint.lk',
      role: 'dispatcher',
      depotId: 'PLG',
      outletId: null,
      vehicleId: null,
      scopeNames: { depot: 'Peliyagoda', outlet: null, vehicle: null },
    },
  ],
}

const notFound = () =>
  new Response(JSON.stringify({ code: 'NOT_FOUND', status: 404, title: 'Not found' }), {
    status: 404,
    headers: { 'content-type': 'application/problem+json' },
  })

const open = async () => {
  await userEvent.click(await screen.findByRole('button', { name: /Nimesha Periyapperuma/ }))
}

describe('the account menu', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('names the signed-in person and their role', async () => {
    stubApi({ 'GET /api/v1/me': () => envelope(me), 'GET /api/v1/demo/users': notFound })
    renderScreen(<AccountMenu />)

    expect(await screen.findByText('Nimesha Periyapperuma')).toBeInTheDocument()
    expect(screen.getByText('Store manager')).toBeInTheDocument()
  })

  it('signs out', async () => {
    stubApi({ 'GET /api/v1/me': () => envelope(me), 'GET /api/v1/demo/users': notFound })
    renderScreen(<AccountMenu />)

    await open()
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => expect(auth.signOut).toHaveBeenCalled())
  })

  it('offers the rest of the demo cast, and switching signs in as them', async () => {
    auth.$fetch.mockResolvedValue({ data: {}, error: null })
    stubApi({ 'GET /api/v1/me': () => envelope(me), 'GET /api/v1/demo/users': () => envelope(cast) })
    renderScreen(<AccountMenu />)

    await open()
    expect(await screen.findByText('Switch user · demo')).toBeInTheDocument()
    expect(screen.getByText('Dispatcher · Depot · Peliyagoda')).toBeInTheDocument()
    // The person already signed in is not offered as somewhere to switch to.
    expect(screen.queryByRole('menuitem', { name: /Nimesha/ })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('menuitem', { name: /Tihara Egodage/ }))

    await waitFor(() =>
      expect(auth.$fetch).toHaveBeenCalledWith('/sign-in/demo', { method: 'POST', body: { userId: 'u-tihara' } }),
    )
  })

  it('offers no switch list when the demo endpoints are not there', async () => {
    stubApi({ 'GET /api/v1/me': () => envelope(me), 'GET /api/v1/demo/users': notFound })
    renderScreen(<AccountMenu />)

    await open()

    expect(await screen.findByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByText('Switch user · demo')).not.toBeInTheDocument()
  })
})
