import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderScreen } from '@/test/api-stub'
import { SignInPage } from '../sign-in-page'

const signIn = vi.hoisted(() => ({ email: vi.fn(), username: vi.fn() }))
vi.mock('../auth-client', () => ({ authClient: { signIn } }))

describe('A0 Sign in', () => {
  afterEach(() => vi.clearAllMocks())

  it('shows the wrong-password state on 401', async () => {
    signIn.email.mockResolvedValue({ data: null, error: { status: 401, message: 'Invalid email or password' } })
    renderScreen(<SignInPage />, '/sign-in')

    await userEvent.type(screen.getByLabelText('Email or phone'), 'tihara.e@waypoint.lk')
    await userEvent.type(screen.getByLabelText('Password'), 'not-her-password')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('That email or password is wrong')
    expect(signIn.email).toHaveBeenCalledWith({ email: 'tihara.e@waypoint.lk', password: 'not-her-password' })
  })

  it('shows the rate-limited state on 429, and signs in by username without an @', async () => {
    signIn.username.mockResolvedValue({ data: null, error: { status: 429, message: 'Too many requests' } })
    renderScreen(<SignInPage />, '/sign-in')

    await userEvent.type(screen.getByLabelText('Email or phone'), 'tihara.e')
    await userEvent.type(screen.getByLabelText('Password'), 'whatever-1234')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many tries')
    expect(signIn.username).toHaveBeenCalled()
  })
})
