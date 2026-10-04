import type { EndOfDayDto } from '@compass/api-client'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HeaderSlotContext } from '@/app/layouts/header-slot'
import { envelope, renderScreen, stubApi } from '@/test/api-stub'
import { EndOfDayPage } from '../end-of-day-page'
import { aPlan, PLAN_ID } from './fixtures'

const self = `/api/v1/plans/${PLAN_ID}`

const aDay = (over: Partial<EndOfDayDto> = {}): EndOfDayDto => ({
  planId: PLAN_ID,
  depotId: 'PLG',
  date: '2026-10-01',
  status: 'PUBLISHED',
  closedAt: null,
  totals: { stops: 3, delivered: 1, partial: 0, failed: 1, unserved: 1, onTimePct: 100, deferred: 0 },
  trips: [
    { tripId: 't1', vehicleCode: 'REF-07', tripNo: 1, driverName: 'Aniqa Razick', status: 'COMPLETED', stops: 2, delivered: 1, partial: 0, failed: 0, onTimePct: 100, openConflicts: 0 },
    { tripId: 't2', vehicleCode: 'REF-03', tripNo: 1, driverName: 'Pradeep Kumara', status: 'COMPLETED', stops: 1, delivered: 0, partial: 0, failed: 1, onTimePct: 100, openConflicts: 0 },
  ],
  followUps: [{ kind: 'FAILED_STOP', title: 'Failed stop · Tech Negombo', detail: 'Outlet closed on arrival.', tripId: 't2', orderId: 'o3' }],
  closeBlockers: [],
  _links: {
    self: { href: `${self}/end-of-day` },
    close: { href: `${self}/close`, method: 'POST', title: 'Close the day', requires: ['If-Match', 'Idempotency-Key'] },
  },
  ...over,
})

/** The page portals its buttons into the shell's header; a plain div stands in for it. */
function renderDay() {
  const slot = document.createElement('div')
  document.body.appendChild(slot)
  renderScreen(
    <HeaderSlotContext.Provider value={slot}>
      <EndOfDayPage />
    </HeaderSlotContext.Provider>,
    '/dispatch/end-of-day?date=2026-10-01',
  )
  return slot
}

function stub(day: EndOfDayDto, routes: Record<string, () => unknown> = {}) {
  return stubApi({
    'GET /api/v1/depots/PLG/plans/2026-10-01': () => envelope(aPlan({ status: 'PUBLISHED', revision: 1, version: 9 })),
    [`GET ${self}/end-of-day`]: () => envelope(day),
    ...routes,
  })
}

describe('21 End-of-day summary', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('AC-PLN-29 shows each trip and closes the day with the plan’s version', async () => {
    const user = userEvent.setup()
    const { calls } = stub(aDay(), { [`POST ${self}/close`]: () => envelope(aPlan({ status: 'CLOSED', version: 10 })) })
    const header = renderDay()

    const row = await screen.findByRole('row', { name: /REF-03/ })
    expect(within(row).getByText('Pradeep Kumara')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Stops delivered' })).getByText('of 3 planned')).toBeInTheDocument()
    expect(within(screen.getByRole('complementary', { name: 'Follow up' })).getByText('Failed stop · Tech Negombo')).toBeInTheDocument()

    await user.click(within(header).getByRole('button', { name: 'Close the day' }))
    const confirm = await screen.findByRole('dialog')
    expect(within(confirm).getByText(/1 stop nobody reached/)).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: 'Close the day' }))

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/close'))).toBe(true))
    const sent = calls.find((c) => c.method === 'POST' && c.path.endsWith('/close'))
    expect(sent?.headers['if-match']).toBe('W/"9"')
    expect(sent?.headers['idempotency-key']).toBeTruthy()
  })

  it('offers no close while a trip is on the road, and says why', async () => {
    stub(
      aDay({
        closeBlockers: ['REF-03 is still on the road'],
        _links: { self: { href: `${self}/end-of-day` } },
      }),
    )
    const header = renderDay()

    expect(await screen.findByText('REF-03 is still on the road')).toBeInTheDocument()
    expect(within(header).queryByRole('button', { name: 'Close the day' })).not.toBeInTheDocument()
  })

  it('says so when no trips ran', async () => {
    stub(aDay({ trips: [], followUps: [] }))
    renderDay()
    expect(await screen.findByText('No trips ran on this day')).toBeInTheDocument()
  })
})
