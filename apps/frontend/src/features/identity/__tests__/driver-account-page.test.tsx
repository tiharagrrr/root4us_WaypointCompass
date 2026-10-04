import 'fake-indexeddb/auto'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, enqueue, setSyncPoke } from '@/offline'
import { envelope, renderScreen, stubApi } from '@/test/api-stub'
import { DriverAccountPage } from '../driver-account-page'

const auth = vi.hoisted(() => ({ signOut: vi.fn() }))
vi.mock('../auth-client', () => ({ authClient: auth }))

const ME = envelope({
  id: 'u-aniqa',
  name: 'Aniqa Razick',
  role: 'driver',
  phoneNumber: '+94 77 123 4567',
  vehicleId: 'REF-07',
  depotId: 'PLG',
  locale: 'en',
  permissions: ['stop:record'],
  _links: {},
})

const queueThree = async () => {
  for (const stopId of ['stop-1', 'stop-2', 'stop-3'])
    await enqueue({ kind: 'driver', type: 'ARRIVED', tripId: 'trip-1', stopId })
}

describe('D13 Sign out', () => {
  beforeEach(async () => {
    setSyncPoke(() => {})
    await db.open()
    await Promise.all([db.outbox.clear(), db.meta.clear()])
    stubApi({ 'GET /api/v1/me': () => ME })
    auth.signOut.mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('AC-IDN-19 D13 waits for an empty outbox', async () => {
    await queueThree()
    renderScreen(<DriverAccountPage />)

    expect(await screen.findByText('3 waiting')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    // Three records still wait: the session is not ended, and the button is the wait itself.
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(auth.signOut).not.toHaveBeenCalled()
    // The card offers no way to throw the records away.
    expect(screen.queryByRole('button', { name: /discard|delete|clear|skip/i })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button').map((button) => button.textContent)).not.toContain('Discard')

    // The last record goes through: now, and only now, the app signs out.
    await db.outbox.clear()
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1))
  })
})
