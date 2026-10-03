import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, page, renderScreen, stubApi } from '@/test/api-stub'
import { PlanPage } from '../plan-page'
import { aContext, anUnplanned, aPlan, aTrip, aVehicleOption, DATE, PLAN_ID } from './fixtures'

const day = (over: { plan?: ReturnType<typeof aPlan>; trips?: unknown[]; unplanned?: unknown[] } = {}) => ({
  [`GET /api/v1/depots/PLG/plans/${DATE}`]: () => envelope(over.plan ?? aPlan()),
  [`GET /api/v1/plans/${PLAN_ID}`]: () => envelope(over.plan ?? aPlan()),
  [`GET /api/v1/plans/${PLAN_ID}/unplanned`]: () => page(over.unplanned ?? [anUnplanned(1), anUnplanned(2)]),
  [`GET /api/v1/plans/${PLAN_ID}/trips`]: () => page(over.trips ?? []),
  [`GET /api/v1/plans/${PLAN_ID}/context`]: () => envelope(aContext()),
  [`GET /api/v1/plans/${PLAN_ID}/vehicle-options`]: () =>
    page([
      aVehicleOption(),
      aVehicleOption({ vehicleId: 'veh-dry', code: 'DRY-22', temp: 'AMBIENT' }),
      aVehicleOption({ vehicleId: 'veh-11', code: 'REF-11', status: 'WORKSHOP', available: false, unavailableReason: 'WORKSHOP', tripsLeft: 0, nextTripNo: null }),
    ]),
})

const renderPlan = () =>
  renderScreen(
    <Routes>
      <Route path="/dispatch/plan/:date" element={<PlanPage />} />
    </Routes>,
    `/dispatch/plan/${DATE}`,
  )

describe('05 to 09 Plan', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('AC-PLN-13 the wizard saves one edit list', async () => {
    const user = userEvent.setup()
    const { calls } = stubApi({
      ...day(),
      [`POST /api/v1/plans/${PLAN_ID}/validate`]: () => envelope({ violations: [], introduced: [] }),
      [`POST /api/v1/plans/${PLAN_ID}/edits`]: () => envelope(aPlan({ version: 8 })),
    })
    renderPlan()

    // 05: the day has no vehicles yet, and both ways to start come from the plan's links.
    expect(await screen.findByText(/No vehicles in .*’s plan yet/)).toBeInTheDocument()
    expect(screen.getByText('2 orders · 2 vehicles free · 1 in workshop')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Auto-suggest a plan' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add Trip' }))

    // 06: the workshop reefer cannot be picked.
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: /REF-11/ })).toBeDisabled()
    await user.click(within(dialog).getByRole('radio', { name: /REF-07/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Next: add orders' }))

    // 07: the engine runs in the browser; adding an order puts it on the trip with its arrival.
    expect(await within(dialog).findByText('Add orders to Trip 1. The first order sets the brand and district.')).toBeInTheDocument()
    const orders = within(dialog).getByRole('region', { name: 'Orders' })
    await user.click(within(orders).getAllByRole('button', { name: 'Add' })[0]!)
    const trip = within(dialog).getByRole('region', { name: 'REF-07 trip 1' })
    expect(within(trip).getByText('WF-0171')).toBeInTheDocument()
    expect(within(trip).getByText('DEPARTS 03:30')).toBeInTheDocument()
    // 03:30 + 37 min out, then waits for the 05:00 window.
    expect(within(trip).getByText('04:07')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save Trip' }))

    // 08: the server checks the edits, then one edit list is saved with the plan's version.
    expect(await within(dialog).findByText('Checks pass')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save Trip' }))

    const saved = calls.find((c) => c.method === 'POST' && c.path.endsWith('/edits'))
    expect(saved?.body).toEqual({
      ops: [
        { op: 'ADD_TRIP', vehicleId: 'veh-ref', tripNo: 1, brand: 'FRESH', districtId: 'gampaha' },
        { op: 'ASSIGN_ORDER', orderId: 'ord-1', tripKey: 'REF-07#1' },
      ],
    })
    expect(saved?.headers['if-match']).toBe('W/"7"')
    expect(saved?.headers['idempotency-key']).toBeTruthy()
  })

  it('09 shows the planned vehicles and what is left', async () => {
    stubApi(
      day({
        plan: aPlan({ summary: { trips: 1, plannedOrders: 2, unplanned: 0, undecided: 0 } }),
        trips: [aTrip()],
        unplanned: [],
      }),
    )
    renderPlan()

    expect(await screen.findByText('2 of 2 orders planned')).toBeInTheDocument()
    expect(screen.getByText('1 vehicles · 1 trips · every trip passes its checks')).toBeInTheDocument()
    expect(screen.getByText('Trip 1 · Fresh · Gampaha')).toBeInTheDocument()
    expect(screen.getByText('Wattala, Ja-Ela')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View and edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirm trips/ })).toBeEnabled()
  })

  it('offers no actions when the plan carries no links', async () => {
    stubApi(day({ plan: aPlan({ _links: { self: { href: `/api/v1/plans/${PLAN_ID}` } } }) }))
    renderPlan()

    expect(await screen.findByText(/No vehicles in .*’s plan yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Trip' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Auto-suggest a plan' })).not.toBeInTheDocument()
  })

  it('shows the problem and a retry when the plan will not load', async () => {
    stubApi({
      [`GET /api/v1/depots/PLG/plans/${DATE}`]: () =>
        new Response(JSON.stringify({ code: 'NOT_FOUND', status: 404, title: 'Not found', detail: 'The plan was not found.' }), {
          status: 404,
          headers: { 'content-type': 'application/problem+json' },
        }),
    })
    renderPlan()

    expect(await screen.findByText('The plan was not found.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
