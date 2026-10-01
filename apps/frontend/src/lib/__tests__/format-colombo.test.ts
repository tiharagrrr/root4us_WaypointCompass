import { describe, expect, it } from 'vitest'
import { formatColombo, toColomboDate } from '../format-colombo'

describe('formatColombo', () => {
  it('formats an instant in Asia/Colombo time (UTC+05:30)', () => {
    expect(formatColombo('2026-10-01T10:25:00Z', 'EEE HH:mm')).toBe('Thu 15:55')
    expect(formatColombo(new Date('2026-10-01T10:25:00Z'), 'EEEE d MMMM yyyy')).toBe('Thursday 1 October 2026')
  })

  it('keeps an offset instant as the same moment', () => {
    expect(formatColombo('2026-10-02T03:30:00+05:30', 'dd/MM/yy H:mm')).toBe('02/10/26 3:30')
  })

  it('rolls the business date over at Colombo midnight, not UTC midnight', () => {
    expect(toColomboDate('2026-10-01T18:29:59Z')).toBe('2026-10-01')
    expect(toColomboDate('2026-10-01T18:30:00Z')).toBe('2026-10-02')
  })

  it('supports 12-hour time and quoted text', () => {
    expect(formatColombo('2026-10-01T10:30:00Z', "h:mm a 'on' EEE")).toBe('4:00 PM on Thu')
    expect(formatColombo('2026-09-30T18:45:00Z', 'hh:mm a')).toBe('12:15 AM')
  })

  it('refuses an invalid instant', () => {
    expect(() => formatColombo('not a date', 'HH:mm')).toThrow(RangeError)
  })
})
