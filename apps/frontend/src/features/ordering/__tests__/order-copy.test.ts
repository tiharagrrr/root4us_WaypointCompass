import { describe, expect, it } from 'vitest'
import { pickedLine, sendHint, sendLabel } from '../order-copy'
import { countdownLabel } from '../order-format'
import { chilled, item, order } from './fixtures'

describe('the copy the store screens build', () => {
  it('M1 names the order, the one still open and the cutoff', () => {
    const dry = order()
    expect(sendLabel(dry)).toBe('Send dry order')
    expect(sendHint(dry, [dry, chilled()])).toBe(
      'Sends order 1 of 2. The chilled order stays open until you send it. Orders close at 4:00 PM.',
    )
  })

  it('M1b drops the cutoff once the day’s other order has gone', () => {
    const sentDry = order({ status: 'SUBMITTED', submittedAt: '2026-10-01T14:12:00+05:30' })
    const open = chilled()
    expect(sendLabel(open)).toBe('Send chilled order')
    expect(sendHint(open, [sentDry, open])).toBe('Sends order 2 of 2. The dry order went to the dispatcher at 14:12.')
  })

  it('M2 names the following run instead of the cutoff', () => {
    const rolled = order({ afterCutoff: true, deliveryDate: '2026-10-02' })
    expect(sendLabel(rolled)).toBe('Send dry order for Fri 2 Oct')
    expect(sendHint(rolled, [rolled, chilled()])).toBe(
      'Sends order 1 of 2 for the following run. The chilled order stays open until you send it.',
    )
  })

  it('M1a counts the pick in the pack word the items share', () => {
    const sugar = item()
    const rice = item({ id: 'i-rice', packLabel: 'Bag ×4', unitWeightKg: 20 })
    expect(pickedLine([], {})).toBe('Nothing selected yet.')
    expect(pickedLine([sugar], { [sugar.id]: 3 })).toBe('1 selected · 3 cases · 30 kg.')
    expect(pickedLine([sugar, rice], { [sugar.id]: 1, [rice.id]: 1 })).toBe('2 selected · 2 packs · 30 kg.')
  })

  it('counts down to the cutoff and stops at it', () => {
    const cutoff = '2026-10-01T16:00:00+05:30'
    expect(countdownLabel(cutoff, new Date('2026-10-01T14:12:00+05:30'))).toBe('1H 48M LEFT')
    expect(countdownLabel(cutoff, new Date('2026-10-01T15:48:00+05:30'))).toBe('12M LEFT')
    expect(countdownLabel(cutoff, new Date('2026-10-01T15:59:30+05:30'))).toBe('LESS THAN A MINUTE')
    expect(countdownLabel(cutoff, new Date('2026-10-01T16:00:00+05:30'))).toBeNull()
  })
})
