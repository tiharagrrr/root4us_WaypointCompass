import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, renderScreen, stubApi } from '@/test/api-stub'
import { DriverSignInPage } from '../driver-sign-in-page'

const auth = vi.hoisted(() => ({ phoneNumber: { sendOtp: vi.fn(), verify: vi.fn() } }))
vi.mock('../auth-client', () => ({ authClient: auth }))

describe('D0a Sign in and D0b Enter code · driver', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('AC-IDN-15 sends the code to the +94 number and signs in with it', async () => {
    auth.phoneNumber.sendOtp.mockResolvedValue({ data: { message: 'sent' }, error: null })
    auth.phoneNumber.verify.mockResolvedValue({ data: { status: true }, error: null })
    stubApi({ 'GET /api/v1/me': () => envelope({ id: 'u1', name: 'Aniqa Razick', role: 'driver', vehicleId: 'v1' }) })
    renderScreen(<DriverSignInPage />, '/sign-in/driver')

    await userEvent.type(screen.getByLabelText('Phone number'), '077 604 1932')
    await userEvent.click(screen.getByRole('button', { name: 'Send me a code' }))
    await waitFor(() => expect(auth.phoneNumber.sendOtp).toHaveBeenCalledWith({ phoneNumber: '+94776041932' }))

    await userEvent.type(await screen.findByLabelText('Code from the SMS'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(auth.phoneNumber.verify).toHaveBeenCalledWith({ phoneNumber: '+94776041932', code: '123456' }))
  })

  it('refuses a number that is not a Sri Lankan mobile without sending anything', async () => {
    renderScreen(<DriverSignInPage />, '/sign-in/driver')

    await userEvent.type(screen.getByLabelText('Phone number'), '12345')
    await userEvent.click(screen.getByRole('button', { name: 'Send me a code' }))

    expect(await screen.findByText('Enter a Sri Lankan mobile number, like 077 604 1932.')).toBeInTheDocument()
    expect(auth.phoneNumber.sendOtp).not.toHaveBeenCalled()
  })

  it('AC-IDN-17 says when the code is wrong or stale', async () => {
    auth.phoneNumber.sendOtp.mockResolvedValue({ data: { message: 'sent' }, error: null })
    auth.phoneNumber.verify.mockResolvedValue({ data: null, error: { status: 400, message: 'Invalid OTP' } })
    renderScreen(<DriverSignInPage />, '/sign-in/driver?phone=0776041932')

    await userEvent.click(screen.getByRole('button', { name: 'Send me a code' }))
    await userEvent.type(await screen.findByLabelText('Code from the SMS'), '000000')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('That code is wrong or has expired')
  })
})
