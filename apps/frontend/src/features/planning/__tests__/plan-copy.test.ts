import { describe, expect, it } from 'vitest'
import { dayStatus } from '../plan-copy'

describe('dayStatus', () => {
  // Orders for Fri 2 Oct close on Thu 1 Oct, at the depot's cutoff in force.
  const at = (time: string) => new Date(`2026-10-01T${time}:00+05:30`)

  it('follows the depot cutoff an admin set, not 16:00', () => {
    expect(dayStatus('2026-10-02', at('15:30'), 960)).toBe('ORDERS OPEN')
    expect(dayStatus('2026-10-02', at('15:30'), 900)).toBe('NOT STARTED')
    expect(dayStatus('2026-10-02', at('16:30'), 1020)).toBe('ORDERS OPEN')
  })

  it('says nothing until the cutoff has loaded', () => {
    expect(dayStatus('2026-10-02', at('15:30'), undefined)).toBe('')
  })
})
