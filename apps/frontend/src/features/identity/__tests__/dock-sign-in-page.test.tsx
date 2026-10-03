import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderScreen, stubApi } from '@/test/api-stub'
import { DockSignInPage } from '../dock-sign-in-page'

const auth = vi.hoisted(() => ({ $fetch: vi.fn() }))
vi.mock('../auth-client', () => ({ authClient: auth }))

const type = async (user: ReturnType<typeof userEvent.setup>, pin: string) => {
  for (const digit of pin) await user.click(screen.getByRole('button', { name: digit }))
}

describe('L1 Sign in · dock', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('signs in with the depot, the four digits and this tablet’s device id', async () => {
    const user = userEvent.setup()
    auth.$fetch.mockResolvedValue({ data: { ok: true }, error: null })
    stubApi({ 'GET /api/v1/me': () => ({ data: { id: 'u1', name: 'Harini De Mel', role: 'loader', depotId: 'PLG' }, meta: {} }) })
    renderScreen(<DockSignInPage />, '/sign-in/dock')

    await type(user, '4821')

    await waitFor(() => expect(auth.$fetch).toHaveBeenCalledTimes(1))
    const [path, init] = auth.$fetch.mock.calls[0] as [string, { method: string; body: Record<string, unknown> }]
    expect(path).toBe('/sign-in/pin')
    expect(init.method).toBe('POST')
    expect(init.body).toMatchObject({ depotId: 'PLG', pin: '4821' })
    // A dock session belongs to the tablet, not the person: the device id decides whether this
    // tablet may sign a loader in at all.
    expect(init.body.deviceId).toBeTruthy()
  })

  it('says what a wrong PIN means and clears the keypad', async () => {
    const user = userEvent.setup()
    auth.$fetch.mockResolvedValue({ data: null, error: { code: 'WRONG_PIN', message: 'Wrong PIN', status: 401 } })
    renderScreen(<DockSignInPage />, '/sign-in/dock')

    await type(user, '1111')

    expect(await screen.findByRole('alert')).toHaveTextContent('That PIN is not one of this depot’s loaders. Try again.')
    expect(screen.getByRole('status', { name: '0 of 4 digits entered' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
  })

  it('says when the tablet is not a dock device for that depot', async () => {
    const user = userEvent.setup()
    auth.$fetch.mockResolvedValue({
      data: null,
      error: { code: 'NOT_A_DOCK_DEVICE', message: 'This device is not a dock device for this depot.', status: 403 },
    })
    renderScreen(<DockSignInPage />, '/sign-in/dock')

    await type(user, '4821')
    expect(await screen.findByRole('alert')).toHaveTextContent('Ask your admin to add it.')
  })
})
