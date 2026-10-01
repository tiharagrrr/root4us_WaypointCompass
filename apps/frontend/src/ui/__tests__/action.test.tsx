import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Action } from '../action'

describe('<Action>', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an object without href', { title: 'Deactivate' }],
    ['a string', '/api/v1/users/u1/deactivate'],
  ])('renders nothing when the link is %s', (_, link) => {
    const { container } = render(
      <Action link={link} onAction={vi.fn()}>
        Deactivate
      </Action>,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders a button labelled with the link title when the resource offers the action', () => {
    render(<Action link={{ href: '/api/v1/invitations/i1/resend', method: 'POST', title: 'Resend invite' }} onAction={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Resend invite' })).toBeEnabled()
  })

  it('sends a new Idempotency-Key per press and If-Match when the link requires it', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const link = { href: '/api/v1/users/u1', method: 'PATCH' as const, title: 'Edit', requires: ['If-Match'] }
    render(<Action link={link} version={3} onAction={onAction} />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Edit' }))

    expect(onAction).toHaveBeenCalledTimes(2)
    const first = onAction.mock.calls[0]?.[0]
    const second = onAction.mock.calls[1]?.[0]
    expect(first.link).toBe(link)
    expect(first.headers['If-Match']).toBe('W/"3"')
    expect(first.headers['Idempotency-Key']).toBe(first.idempotencyKey)
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey)
  })

  it('asks first when confirm is set, and runs only on confirm', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(
      <Action
        link={{ href: '/api/v1/users/u1/deactivate', method: 'POST', title: 'Deactivate' }}
        variant="destructive"
        confirm={{ title: 'Deactivate Nimesha?', description: 'They can no longer sign in.' }}
        onAction={onAction}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Deactivate' }))
    expect(onAction).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate Nimesha?' })
    expect(dialog).toHaveTextContent('They can no longer sign in.')

    const buttons = screen.getAllByRole('button', { name: 'Deactivate' })
    await user.click(buttons[buttons.length - 1] as HTMLElement)
    expect(onAction).toHaveBeenCalledTimes(1)
  })
})
