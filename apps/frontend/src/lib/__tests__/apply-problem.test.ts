import { describe, expect, it, vi } from 'vitest'
import { applyProblem, toFormPath } from '../apply-problem'

const problem = (errors: { field: string; code: string; message: string }[]) => ({
  code: 'VALIDATION_FAILED',
  title: 'Some fields need attention',
  detail: undefined,
  errors,
})

describe('applyProblem', () => {
  it('maps errors[] onto react-hook-form fields, focusing the first', () => {
    const setError = vi.fn()
    const mapped = applyProblem({ setError }, problem([
      { field: 'email', code: 'email', message: 'Enter a valid email' },
      { field: 'lines[2].qty', code: 'min', message: 'Enter at least 1' },
    ]))

    expect(mapped).toBe(true)
    expect(setError).toHaveBeenCalledWith('email', { type: 'email', message: 'Enter a valid email' }, { shouldFocus: true })
    expect(setError).toHaveBeenCalledWith('lines.2.qty', { type: 'min', message: 'Enter at least 1' }, { shouldFocus: false })
    expect(setError).toHaveBeenCalledTimes(2)
  })

  it('sends errors for unknown fields, or a problem without field errors, to root.server', () => {
    const setError = vi.fn()
    applyProblem({ setError }, problem([{ field: 'outletId', code: 'scope', message: 'Pick an outlet in your scope' }]), { fields: ['name'] })
    expect(setError).toHaveBeenCalledWith('root.server', { type: 'VALIDATION_FAILED', message: 'Pick an outlet in your scope' })

    const setError2 = vi.fn()
    expect(applyProblem({ setError: setError2 }, { code: 'CUTOFF_PASSED', title: 'The cutoff has passed', detail: 'Orders closed at 16:00.', errors: [] })).toBe(false)
    expect(setError2).toHaveBeenCalledWith('root.server', { type: 'CUTOFF_PASSED', message: 'Orders closed at 16:00.' })
  })

  it('converts bracket indexes to dot paths', () => {
    expect(toFormPath('stops[0].lines[12].qty')).toBe('stops.0.lines.12.qty')
  })
})
