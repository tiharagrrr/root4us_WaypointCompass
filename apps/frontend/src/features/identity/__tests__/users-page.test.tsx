import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, renderScreen, stubApi } from '@/test/api-stub'
import { UsersPage } from '../users-page'

const scopeNames = { depot: 'Peliyagoda', outlet: null, vehicle: null }

const expired = {
  id: 'i1',
  name: 'Pradeep Kumara',
  email: null,
  phoneNumber: '+94769031182',
  role: 'driver',
  depotId: 'PLG',
  outletId: null,
  vehicleId: null,
  scopeNames,
  status: 'EXPIRED',
  expiresAt: '2026-10-03T09:00:00+05:30',
  sentAt: null,
  acceptedAt: null,
  createdAt: '2026-09-30T09:00:00+05:30',
  _links: { self: { href: '/api/v1/invitations/i1' }, resend: { href: '/api/v1/invitations/i1/resend', method: 'POST', title: 'Resend' } },
}

const user = (id: string, name: string, links: Record<string, unknown>) => ({
  id,
  name,
  email: `${id}@waypoint.lk`,
  username: null,
  phoneNumber: null,
  role: 'dispatcher',
  depotId: 'PLG',
  outletId: null,
  vehicleId: null,
  banned: false,
  hasPin: false,
  demoPin: null,
  scopeNames,
  createdAt: '2026-09-30T09:00:00+05:30',
  _links: { self: { href: `/api/v1/users/${id}` }, ...links },
})

describe('A1 Users', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('AC-IDN-03 shows an expired invitation with Resend', async () => {
    stubApi({
      'GET /api/v1/users': () =>
        page([
          user('u1', 'Tihara Egodage', { edit: { href: '/api/v1/users/u1', method: 'PATCH' } }),
          user('u2', 'Kavinda Senanayake', {}),
        ]),
      'GET /api/v1/invitations': () => page([expired], { create: { href: '/api/v1/invitations', method: 'POST' } }),
    })
    renderScreen(<UsersPage />)

    expect(await screen.findByText('Pradeep Kumara')).toBeInTheDocument()
    expect(screen.getByText('Invite expired')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resend invite' })).toBeInTheDocument()
    expect(screen.getByText('+94 76 903 1182')).toBeInTheDocument()
    expect(screen.getAllByText('Depot · Peliyagoda').length).toBeGreaterThan(0)
  })

  it('shows Edit only for users that carry the edit link', async () => {
    stubApi({
      'GET /api/v1/users': () =>
        page([
          user('u1', 'Tihara Egodage', { edit: { href: '/api/v1/users/u1', method: 'PATCH' } }),
          user('u2', 'Kavinda Senanayake', {}),
        ]),
      'GET /api/v1/invitations': () => page([]),
    })
    renderScreen(<UsersPage />)

    expect(await screen.findByText('Kavinda Senanayake')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1)
  })

  it("AC-IDN-66 in demo mode the edit dialog shows a loader's PIN", async () => {
    const harini = {
      ...user('u3', 'Harini De Mel', {
        edit: { href: '/api/v1/users/u3', method: 'PATCH' },
        setPin: { href: '/api/v1/users/u3/pin', method: 'PUT', title: 'Change PIN' },
      }),
      role: 'loader',
      hasPin: true,
      demoPin: '2468',
    }
    stubApi({
      'GET /api/v1/users': () => page([harini]),
      'GET /api/v1/invitations': () => page([]),
      'GET /api/v1/users/scope-options': () => ({ data: { depots: [{ id: 'PLG', name: 'Peliyagoda' }], outlets: [], vehicles: [] } }),
      'PUT /api/v1/users/u3/pin': () => ({ data: { ...harini, demoPin: '9753' } }),
    })
    const actor = userEvent.setup()
    renderScreen(<UsersPage />)

    await actor.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(await screen.findByText('Current PIN: 2468. A new one replaces it.')).toBeInTheDocument()

    await actor.type(screen.getByPlaceholderText('4 digits'), '9753')
    await actor.click(screen.getByRole('button', { name: 'Change PIN' }))
    expect(await screen.findByText('Current PIN: 9753. A new one replaces it.')).toBeInTheDocument()
  })
})
