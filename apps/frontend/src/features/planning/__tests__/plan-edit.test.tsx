import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, page, renderScreen, stubApi } from '@/test/api-stub'
import { PlanPage } from '../plan-page'
import { aContext, aDraftTrip, aPlan, aTrip, aVehicleOption, type ContextOptions, DATE, PLAN_ID } from './fixtures'

/** 09 with REF-07 trip 1 carrying WF-0171 and WF-0172, and the engine context to match. */
function savedDay(context: ContextOptions = {}) {
  return stubApi({
    [`GET /api/v1/depots/PLG/plans/${DATE}`]: () => envelope(aPlan({ summary: { trips: 1, plannedOrders: 2, unplanned: 0, undecided: 0 } })),
    [`GET /api/v1/plans/${PLAN_ID}/unplanned`]: () => page([]),
    [`GET /api/v1/plans/${PLAN_ID}/trips`]: () => page([aTrip()]),
    [`GET /api/v1/plans/${PLAN_ID}/context`]: () => envelope(aContext({ trips: [aDraftTrip(['ord-1', 'ord-2'])], ...context })),
    [`GET /api/v1/plans/${PLAN_ID}/vehicle-options`]: () => page([aVehicleOption({ tripsUsed: 1, tripsLeft: 1, nextTripNo: 2 })]),
    [`POST /api/v1/plans/${PLAN_ID}/edits`]: () => envelope(aPlan({ version: 8 })),
  })
}

const renderPlan = () =>
  renderScreen(
    <Routes>
      <Route path="/dispatch/plan/:date" element={<PlanPage />} />
    </Routes>,
    `/dispatch/plan/${DATE}`,
  )

async function openVehicle() {
  const user = userEvent.setup()
  renderPlan()
  await user.click(await screen.findByRole('button', { name: 'View and edit' }))
  const dialog = await screen.findByRole('dialog')
  return { user, dialog }
}

const savedEdits = (calls: ReturnType<typeof stubApi>['calls']) =>
  calls.filter((c) => c.method === 'POST' && c.path.endsWith('/edits'))

describe('10 and 11 View and edit vehicle', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('10 removing a stop saves the change straight to the plan', async () => {
    const { calls } = savedDay()
    const { user, dialog } = await openVehicle()

    expect(within(dialog).getByText('REF-07 · Reefer')).toBeInTheDocument()
    expect(within(dialog).getByText('Editing a saved vehicle')).toBeInTheDocument()
    const trip = within(dialog).getByRole('region', { name: 'REF-07 trip 1' })
    expect(within(trip).getByText('Checks pass')).toBeInTheDocument()

    await user.click(within(trip).getByRole('button', { name: 'Remove WF-0172' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    const [saved] = savedEdits(calls)
    expect(saved?.body).toEqual({
      ops: [
        { op: 'UNASSIGN_ORDER', orderId: 'ord-2' },
        { op: 'RESEQUENCE', tripKey: 'REF-07#1', orderIds: ['ord-1'] },
      ],
    })
    expect(saved?.headers['if-match']).toBe('W/"7"')
  })

  it('AC-PLN-21 a published plan saves a change as a revision with a reason', async () => {
    const { calls } = stubApi({
      [`GET /api/v1/depots/PLG/plans/${DATE}`]: () =>
        envelope(aPlan({ status: 'PUBLISHED', revision: 1, summary: { trips: 1, plannedOrders: 2, unplanned: 0, undecided: 0 } })),
      [`GET /api/v1/plans/${PLAN_ID}/unplanned`]: () => page([]),
      [`GET /api/v1/plans/${PLAN_ID}/trips`]: () => page([aTrip()]),
      [`GET /api/v1/plans/${PLAN_ID}/context`]: () => envelope(aContext({ trips: [aDraftTrip(['ord-1', 'ord-2'])] })),
      [`GET /api/v1/plans/${PLAN_ID}/vehicle-options`]: () => page([aVehicleOption({ tripsUsed: 1, tripsLeft: 1, nextTripNo: 2 })]),
      'GET /api/v1/deferral-reasons': () => page([{ code: 'OVER_CAPACITY', label: 'Over capacity', active: true }]),
      [`POST /api/v1/plans/${PLAN_ID}/edits`]: () => envelope(aPlan({ status: 'PUBLISHED', revision: 2, version: 8 })),
    })
    const { user, dialog } = await openVehicle()

    const bar = within(dialog).getByRole('region', { name: 'Revision reason' })
    expect(within(bar).getByText('revision 2')).toBeInTheDocument()
    const trip = within(dialog).getByRole('region', { name: 'REF-07 trip 1' })
    await user.click(within(trip).getByRole('button', { name: 'Remove WF-0172' }))
    const save = within(dialog).getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()

    await user.click(within(bar).getByRole('combobox', { name: 'Reason' }))
    await user.click(await screen.findByRole('option', { name: 'Over capacity' }))
    await user.type(within(bar).getByRole('textbox', { name: 'Note' }), 'Gampaha goes tomorrow')
    await user.click(save)

    expect(savedEdits(calls)[0]?.body).toEqual({
      ops: [
        { op: 'UNASSIGN_ORDER', orderId: 'ord-2' },
        { op: 'RESEQUENCE', tripKey: 'REF-07#1', orderIds: ['ord-1'] },
      ],
      reasonCode: 'OVER_CAPACITY',
      note: 'Gampaha goes tomorrow',
    })
  })

  it('10 removing the vehicle takes its trips off the plan', async () => {
    const { calls } = savedDay()
    const { user, dialog } = await openVehicle()

    await user.click(within(dialog).getByRole('button', { name: 'Remove from plan' }))

    expect(savedEdits(calls)[0]?.body).toEqual({ ops: [{ op: 'REMOVE_TRIP', tripKey: 'REF-07#1' }] })
  })

  it('11 a fix for an over-full trip saves as one edit list', async () => {
    const { calls } = savedDay({ ref07VolumeM3: 3, ref03: true })
    const { user, dialog } = await openVehicle()

    const trip = within(dialog).getByRole('region', { name: 'REF-07 trip 1' })
    expect(within(trip).getByText('Over volume')).toBeInTheDocument()
    expect(within(trip).getByText('Over volume by 1 m³')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeDisabled()

    await user.click(within(trip).getByRole('button', { name: 'Move to REF-03' }))

    const ops = (savedEdits(calls)[0]?.body as { ops: { op: string; tripKey?: string; vehicleId?: string }[] }).ops
    expect(ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: 'ADD_TRIP', vehicleId: 'veh-ref3', tripNo: 1 }),
        expect.objectContaining({ op: 'MOVE_ORDER', tripKey: 'REF-03#1' }),
      ]),
    )
  })

  it('AC-PLN-42 the dialog waits for the plan and lets the vehicle be changed', async () => {
    // The engine context answers only when the test lets it, as it does on a slow connection.
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => (release = resolve))
    stubApi({
      [`GET /api/v1/depots/PLG/plans/${DATE}`]: () => envelope(aPlan({ summary: { trips: 1, plannedOrders: 2, unplanned: 0, undecided: 0 } })),
      [`GET /api/v1/plans/${PLAN_ID}/unplanned`]: () => page([]),
      [`GET /api/v1/plans/${PLAN_ID}/trips`]: () => page([aTrip()]),
      [`GET /api/v1/plans/${PLAN_ID}/context`]: async () => {
        await held
        return envelope(aContext({ trips: [aDraftTrip(['ord-1', 'ord-2'])] }))
      },
      [`GET /api/v1/plans/${PLAN_ID}/vehicle-options`]: () =>
        page([
          aVehicleOption({ tripsUsed: 1, tripsLeft: 1, nextTripNo: 2 }),
          aVehicleOption({ vehicleId: 'veh-dry', code: 'DRY-22', temp: 'AMBIENT' }),
        ]),
    })
    const { user, dialog } = await openVehicle()

    // Opened before the context: the vehicle is named and the trip is still loading, not missing.
    expect(within(dialog).getByText('REF-07 · Reefer')).toBeInTheDocument()
    expect(within(dialog).queryByRole('region', { name: 'REF-07 trip 1' })).not.toBeInTheDocument()
    release()
    const trip = await within(dialog).findByRole('region', { name: 'REF-07 trip 1' })
    expect(within(trip).getByText('WF-0171')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    // A new trip: from Orders the Vehicle step is one click back, and another vehicle can be picked.
    await user.click(screen.getByRole('button', { name: /\+ Add vehicle/ }))
    const wizard = await screen.findByRole('dialog')
    await user.click(within(wizard).getByRole('radio', { name: /REF-07/ }))
    await user.click(within(wizard).getByRole('button', { name: 'Next: add orders' }))
    expect(await within(wizard).findByRole('region', { name: 'REF-07 trip 2' })).toBeInTheDocument()
    await user.click(within(wizard).getByRole('button', { name: 'Back to Vehicle' }))
    await user.click(within(wizard).getByRole('radio', { name: /DRY-22/ }))
    await user.click(within(wizard).getByRole('button', { name: 'Next: add orders' }))
    expect(await within(wizard).findByRole('region', { name: 'DRY-22 trip 1' })).toBeInTheDocument()
    expect(within(wizard).getByText('Add orders to Trip 1. The first order sets the brand and district.')).toBeInTheDocument()
  })
})
