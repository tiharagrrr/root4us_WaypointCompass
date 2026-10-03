import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode, useState } from 'react'
import { Route, Routes } from 'react-router'
import { HeaderSlotContext } from '@/app/layouts/header-slot'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, page, renderScreen, stubApi } from '@/test/api-stub'
import { ConfirmPage } from '../confirm-page'
import { PublishPage } from '../publish-page'
import { UnplannedPage } from '../unplanned-page'
import { aContext, aDraftTrip, anUnplanned, aPlan, aTrip, aVehicleOption, DATE, PLAN_ID } from './fixtures'

const write = (href: string) => ({ href, method: 'POST', requires: ['If-Match', 'Idempotency-Key'] })

const REASONS = [
  { code: 'OVER_CAPACITY', label: 'Vehicle capacity', description: 'Every suitable vehicle was full for this run.' },
  { code: 'ACCESS_ISSUE', label: 'Outlet access', description: 'The vehicle could not reach the outlet in time.' },
].map((r, i) => ({ ...r, fromEngine: true, active: true, sortOrder: i, _links: { self: { href: `/api/v1/deferral-reasons/${r.code}` } } }))

/** A day with REF-07 trip 1 (WF-0171) planned, and the given orders left over. */
function dayWith(unplanned: ReturnType<typeof anUnplanned>[], extra: Record<string, () => unknown> = {}, plan = aPlan()) {
  return stubApi({
    [`GET /api/v1/depots/PLG/plans/${DATE}`]: () => envelope(plan),
    [`GET /api/v1/plans/${PLAN_ID}`]: () => envelope(plan),
    [`GET /api/v1/plans/${PLAN_ID}/unplanned`]: () => page(unplanned),
    [`GET /api/v1/plans/${PLAN_ID}/trips`]: () => page([aTrip({ stops: aTrip().stops.slice(0, 1), loadWeightKg: 1240, loadVolumeM3: 2 })]),
    [`GET /api/v1/plans/${PLAN_ID}/context`]: () =>
      envelope(aContext({ orders: 3, trips: [aDraftTrip(['ord-1'])], unplanned: unplanned.map((u) => ({ orderId: u.orderId, repeatSkip: u.repeatSkip })) })),
    [`GET /api/v1/plans/${PLAN_ID}/vehicle-options`]: () => page([aVehicleOption()]),
    ['GET /api/v1/deferral-reasons']: () => page(REASONS),
    ...extra,
  })
}

/** The shell's header slot, where a page puts its toolbar (Publish plan on 17). */
function WithHeader({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  return (
    <HeaderSlotContext.Provider value={slot}>
      <div ref={setSlot} />
      {children}
    </HeaderSlotContext.Provider>
  )
}

const at = (path: string) =>
  renderScreen(
    <WithHeader>
    <Routes>
      <Route path="/dispatch/plan/:date" element={<p>Step 1</p>} />
      <Route path="/dispatch/plan/:date/confirm" element={<ConfirmPage />} />
      <Route path="/dispatch/plan/:date/unplanned" element={<UnplannedPage />} />
      <Route path="/dispatch/plan/:date/publish" element={<PublishPage />} />
    </Routes>
    </WithHeader>,
    `/dispatch/plan/${DATE}/${path}`,
  )

describe('14 to 18 Confirm, decide and publish', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('14 every trip passes its checks before the dispatcher confirms', async () => {
    const user = userEvent.setup()
    dayWith([anUnplanned(2, { reasonCode: 'OVER_CAPACITY', reasonLabel: 'Vehicle capacity' })])
    at('confirm')

    const check = await screen.findByRole('region', { name: 'Feasibility check' })
    for (const label of ['Weight and volume', 'Correct condition', 'Van-only outlets', 'Delivery windows', 'Fuel quota', 'Home depot'])
      expect(within(check).getByRole('listitem', { name: `${label}: passes` })).toBeInTheDocument()
    expect(screen.getByText('1 order doesn’t fit')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'REF-07' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Confirm trips' }))
    expect(await screen.findByRole('heading', { name: '1 order didn’t fit any trip' })).toBeInTheDocument()
  })

  it('AC-PLN-16 deferring the picked orders sends one decision list with the reason and note', async () => {
    const user = userEvent.setup()
    const { calls } = dayWith([anUnplanned(2, { reasonCode: 'OVER_CAPACITY', reasonLabel: 'Vehicle capacity', deferralStatus: 'PROPOSED' })], {
      [`POST /api/v1/plans/${PLAN_ID}/deferrals/decisions`]: () => envelope(aPlan({ version: 8 })),
    })
    at('unplanned')

    await user.click(await screen.findByRole('checkbox', { name: 'Defer WF-0172' }))
    // The reason is pre-filled from why it did not fit, and the note from the reason's store wording.
    expect(screen.getByRole('radio', { name: /Vehicle capacity/ })).toBeChecked()
    const note = screen.getByRole('textbox', { name: 'Note to the store' })
    expect(note).toHaveValue('Every suitable vehicle was full for this run.')
    await user.clear(note)
    await user.type(note, 'First on the next run')
    await user.click(screen.getByRole('button', { name: 'Defer 1 order' }))

    const sent = calls.find((c) => c.method === 'POST' && c.path.endsWith('/deferrals/decisions'))
    expect(sent?.body).toEqual({
      decisions: [{ orderId: 'ord-2', action: 'DEFER', reasonCode: 'OVER_CAPACITY', note: 'First on the next run' }],
    })
    expect(sent?.headers['if-match']).toBe('W/"7"')
    expect(sent?.headers['idempotency-key']).toBeTruthy()
  })

  it('AC-PLN-05 a repeat skip is deferred only with an override note', async () => {
    const user = userEvent.setup()
    const { calls } = dayWith([anUnplanned(2, { reasonCode: 'OVER_CAPACITY', reasonLabel: 'Vehicle capacity', repeatSkip: true })], {
      [`POST /api/v1/plans/${PLAN_ID}/deferrals/decisions`]: () => envelope(aPlan({ version: 8 })),
    })
    at('unplanned')

    expect(await screen.findByText('Ja-Ela was deferred on the last run too')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Override' }))
    const defer = screen.getByRole('button', { name: 'Defer 1 order' })
    expect(defer).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Why defer Ja-Ela again' }), 'Store closed for stocktake')
    await user.click(defer)

    const sent = calls.find((c) => c.path.endsWith('/deferrals/decisions'))
    expect(sent?.body).toEqual({
      decisions: [
        expect.objectContaining({ orderId: 'ord-2', action: 'DEFER', reasonCode: 'OVER_CAPACITY', overrideNote: 'Store closed for stocktake' }),
      ],
    })
  })

  it('AC-PLN-18 swapping serves a repeat skip in place of an order on the trip', async () => {
    const user = userEvent.setup()
    const { calls } = dayWith([anUnplanned(2, { reasonCode: 'OVER_CAPACITY', reasonLabel: 'Vehicle capacity', repeatSkip: true })], {
      [`POST /api/v1/plans/${PLAN_ID}/deferrals/decisions`]: () => envelope(aPlan({ version: 8 })),
    })
    at('unplanned')

    await user.click(await screen.findByRole('button', { name: 'Swap order' }))
    const dialog = await screen.findByRole('dialog', { name: 'Swap in Ja-Ela' })
    expect(within(dialog).getByRole('radio', { name: /WF-0171/ })).toBeChecked()
    await user.type(within(dialog).getByRole('textbox', { name: 'Note for Wattala' }), 'Moved to the next run')
    await user.click(within(dialog).getByRole('button', { name: 'Swap orders' }))

    const sent = calls.find((c) => c.path.endsWith('/deferrals/decisions'))
    expect(sent?.body).toEqual({
      decisions: [
        {
          orderId: 'ord-2',
          action: 'SWAP',
          reasonCode: 'OVER_CAPACITY',
          tripKey: 'REF-07#1',
          swapOrderId: 'ord-1',
          swapReasonCode: 'OVER_CAPACITY',
          swapNote: 'Moved to the next run',
        },
      ],
    })
  })

  it('AC-PLN-20 blockers are listed and there is no Publish until they clear', async () => {
    dayWith([anUnplanned(2)], {
      [`GET /api/v1/plans/${PLAN_ID}/publish-preview`]: () =>
        envelope({
          opensAt: '2026-10-01T16:00:00+05:30',
          open: true,
          blockers: [{ kind: 'UNDECIDED_ORDER', message: 'WF-0172 has no decision yet', orderId: 'ord-2', orderNo: 'WF-0172' }],
          notify: { loaders: 2, drivers: 1, stores: 2 },
          _links: { self: { href: `/api/v1/plans/${PLAN_ID}/publish-preview` } },
        }),
    })
    at('publish')

    expect(await screen.findByText('WF-0172 has no decision yet')).toBeInTheDocument()
    expect(screen.getByText('1 blocker left')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publish plan' })).not.toBeInTheDocument()
  })

  it('AC-PLN-19 publishing sends the plan version and tells who hears about it', async () => {
    const user = userEvent.setup()
    const { calls } = dayWith(
      [anUnplanned(2, { reasonCode: 'OVER_CAPACITY', reasonLabel: 'Vehicle capacity', deferralStatus: 'CONFIRMED', repeatSkip: true })],
      {
        [`GET /api/v1/plans/${PLAN_ID}/publish-preview`]: () =>
          envelope({
            opensAt: '2026-10-01T16:00:00+05:30',
            open: true,
            blockers: [],
            notify: { loaders: 2, drivers: 1, stores: 2 },
            _links: { self: { href: `/api/v1/plans/${PLAN_ID}/publish-preview` }, publish: write(`/api/v1/plans/${PLAN_ID}/publish`) },
          }),
        [`POST /api/v1/plans/${PLAN_ID}/publish`]: () => envelope(aPlan({ status: 'PUBLISHED', version: 8 })),
      },
      aPlan({ summary: { trips: 1, plannedOrders: 1, unplanned: 1, undecided: 0 } }),
    )
    at('publish')

    expect(await screen.findByText('All 1 unplanned order has a decision')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Deferred orders' })).toHaveTextContent('Ja-Ela')
    await user.click(screen.getByRole('button', { name: 'Publish plan' }))

    const dialog = await screen.findByRole('dialog', { name: /Publish plan for/ })
    expect(within(dialog).getByText('2nd deferral')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Publish plan' }))

    const sent = calls.find((c) => c.method === 'POST' && c.path.endsWith('/publish'))
    expect(sent?.headers['if-match']).toBe('W/"7"')
    expect(await screen.findByText('Step 1')).toBeInTheDocument()
  })
})
