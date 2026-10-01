import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, renderScreen, stubApi } from '@/test/api-stub'
import { InviteUserDialog } from '../invite-user-dialog'

const options = {
  depots: [{ id: 'PLG', name: 'Peliyagoda' }],
  outlets: [{ id: 'OUT021', name: 'Fresh Ja-Ela', depotId: 'PLG' }],
  vehicles: [{ id: 'VEH07', code: 'REF-07', registrationNo: 'WP CBA-1234', depotId: 'PLG' }],
}

describe('A2 Invite user', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('asks for a vehicle once Driver is picked', async () => {
    stubApi({ 'GET /api/v1/users/scope-options': () => envelope(options) })
    renderScreen(<InviteUserDialog open onOpenChange={() => undefined} />)

    expect(await screen.findByText('Choose an outlet')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Driver' }))
    expect(screen.getByText('Choose a vehicle')).toBeInTheDocument()
  })

  it('sends a driver invitation by SMS with the vehicle and its depot', async () => {
    const { calls } = stubApi({
      'GET /api/v1/users/scope-options': () => envelope(options),
      'POST /api/v1/invitations': () => new Response(JSON.stringify(envelope({ id: 'i9' })), { status: 201, headers: { 'content-type': 'application/json' } }),
      'GET /api/v1/invitations': () => envelope([]),
    })
    const onOpenChange = vi.fn()
    renderScreen(<InviteUserDialog open onOpenChange={onOpenChange} />)

    await userEvent.type(screen.getByLabelText('Full name'), 'Kasun Perera')
    await userEvent.type(screen.getByLabelText('Email or phone'), '077 123 4567')
    await userEvent.click(screen.getByRole('radio', { name: 'Driver' }))
    await userEvent.click(await screen.findByRole('combobox', { name: 'Link to' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Vehicle · REF-07 · WP CBA-1234' }))
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Kasun Perera',
      role: 'driver',
      phoneNumber: '+94771234567',
      depotId: 'PLG',
      vehicleId: 'VEH07',
    })
  })
})
