import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PinKeypad } from '../pin-keypad'

const type = async (digits: string) => {
  for (const digit of digits) await userEvent.click(screen.getByRole('button', { name: digit }))
}

const filled = () => screen.getAllByRole('status')[0]?.querySelectorAll('[data-filled="true"]').length

describe('PinKeypad (L1 185:19312)', () => {
  it('calls back once the last digit is typed', async () => {
    const onComplete = vi.fn()
    render(<PinKeypad onComplete={onComplete} />)

    await type('482')
    expect(onComplete).not.toHaveBeenCalled()
    expect(filled()).toBe(3)

    await type('1')
    expect(onComplete).toHaveBeenCalledExactlyOnceWith('4821')
  })

  it('never shows the digits, only how many were typed', async () => {
    render(<PinKeypad onComplete={vi.fn()} />)

    await type('48')

    expect(screen.queryByText('4821')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAccessibleName('2 of 4 digits entered')
  })

  it('takes a digit back with Backspace and drops the lot with Clear', async () => {
    render(<PinKeypad onComplete={vi.fn()} />)

    await type('48')
    await userEvent.click(screen.getByRole('button', { name: 'Backspace' }))
    expect(filled()).toBe(1)

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(filled()).toBe(0)
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled()
  })

  it('clears itself when the screen says so, e.g. after a wrong PIN', async () => {
    const { rerender } = render(<PinKeypad onComplete={vi.fn()} resetKey={1} />)

    await type('482')
    rerender(<PinKeypad onComplete={vi.fn()} resetKey={2} />)

    expect(filled()).toBe(0)
  })

  it('takes no input while the sign-in is in flight', async () => {
    const onComplete = vi.fn()
    render(<PinKeypad onComplete={onComplete} disabled />)

    await type('4821')

    expect(onComplete).not.toHaveBeenCalled()
    expect(filled()).toBe(0)
  })
})
