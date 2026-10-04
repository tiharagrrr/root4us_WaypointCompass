import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, page, renderScreen, stubApi } from '@/test/api-stub'
import { TripOperationsCard } from '../trip-operations-card'
import { aPlan, aTrip, aVehicleOption, DATE, PLAN_ID } from './fixtures'

const TRIP = 'trip-1'
const link = (rel: string) => ({ href: `/api/v1/trips/${TRIP}/${rel}`, method: 'POST', requires: ['If-Match', 'Idempotency-Key'] })

/** Execution's trip summary, with the links 19a reads; only the fields the card uses. */
const summary = (links: Record<string, unknown>) => ({
  id: TRIP,
  tripNo: 1,
  status: 'RELEASED',
  date: DATE,
  depotId: 'PLG',
  brand: 'FRESH',
  tempClass: 'CHILLED',
  vehicle: { id: 'veh-ref', code: 'REF-07', temp: 'REEFER' },
  stops: 3,
  openStops: 3,
  plannedDepartAt: null,
  releasedAt: null,
  downloadedAt: null,
  startedAt: null,
  completedAt: null,
  cantRunReason: 'BREAKDOWN',
  version: 4,
  _links: { self: { href: `/api/v1/trips/${TRIP}` }, ...links },
})

const threeStops = aTrip({
  status: 'RELEASED',
  stops: [1, 2, 3].map((n) => ({
    ...aTrip().stops[0],
    id: `stop-${n}`,
    orderId: `ord-${n}`,
    orderNo: `WF-018${n}`,
    outletName: ['Kandana', 'Ja-Ela', 'Seeduwa'][n - 1],
    seq: n,
  })),
})

function stub(links: Record<string, unknown>, routes: Record<string, (url: URL, init?: RequestInit) => unknown> = {}) {
  return stubApi({
    [`GET /api/v1/trips/${TRIP}`]: () => envelope(summary(links)),
    [`GET /api/v1/depots/PLG/plans/${DATE}`]: () => envelope(aPlan({ status: 'PUBLISHED', revision: 1 })),
    [`GET /api/v1/plans/${PLAN_ID}/trips`]: () => page([threeStops]),
    [`GET /api/v1/plans/${PLAN_ID}/vehicle-options`]: () =>
      page([
        aVehicleOption(),
        aVehicleOption({ vehicleId: 'veh-ref3', code: 'REF-03' }),
        aVehicleOption({ vehicleId: 'veh-dry', code: 'DRY-31', temp: 'AMBIENT' }),
      ]),
    [`GET /api/v1/plans/${PLAN_ID}/driver-options`]: () =>
      page([
        { driverId: 'drv-aniqa', name: 'Aniqa Razick', tripsOnPlan: 1 },
        { driverId: 'drv-nuwan', name: 'Nuwan Gunasekara', tripsOnPlan: 0 },
      ]),
    // The server's projection: the stop sent first arrives 07:46 with 14 minutes spare, the rest later.
    [`POST /api/v1/trips/${TRIP}/resequence/preview`]: (_url, init) => {
      const { stopIds } = JSON.parse(String(init?.body)) as { stopIds: string[] }
      return envelope({
        stops: stopIds.map((stopId, i) => ({ stopId, arrivalAt: `2026-10-02T02:${16 + i * 12}:00.000Z`, spareMin: 14 - i * 12 })),
        violations: [],
      })
    },
    'GET /api/v1/deferral-reasons': () => page([{ code: 'VEHICLE_BREAKDOWN', label: 'Vehicle breakdown', active: true }]),
    ...routes,
  })
}

async function pickReason(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  const bar = within(dialog).getByRole('region', { name: 'Revision reason' })
  await user.click(within(bar).getByRole('combobox', { name: 'Reason' }))
  await user.click(await screen.findByRole('option', { name: 'Vehicle breakdown' }))
}

describe('19b and 20 change a trip on the road', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('AC-PLN-24 re-sequencing sends the stops in their new order with the trip’s version', async () => {
    const user = userEvent.setup()
    const { calls } = stub(
      { reassign: link('reassign'), resequence: link('resequence') },
      { [`POST /api/v1/trips/${TRIP}/resequence`]: () => envelope(threeStops) },
    )
    renderScreen(<TripOperationsCard tripId={TRIP} />)

    await user.click(await screen.findByRole('button', { name: 'Re-sequence' }))
    const dialog = await screen.findByRole('dialog', { name: 'Re-sequence REF-07 stops' })
    const apply = within(dialog).getByRole('button', { name: 'Apply and notify' })
    expect(apply).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'Move Ja-Ela up' }))
    expect(within(dialog).getByText('Ja-Ela moved ahead of Kandana')).toBeInTheDocument()
    await pickReason(user, dialog)
    await user.click(apply)

    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/resequence'))).toBe(true))
    const sent = calls.find((c) => c.path.endsWith('/resequence'))
    expect(sent?.body).toEqual({ stopIds: ['stop-2', 'stop-1', 'stop-3'], reasonCode: 'VEHICLE_BREAKDOWN' })
    expect(sent?.headers['if-match']).toBe('W/"4"')
  })

  it('AC-PLN-23 reassigning offers the vehicles that fit and sends the pick', async () => {
    const user = userEvent.setup()
    const { calls } = stub({ reassign: link('reassign') }, { [`POST /api/v1/trips/${TRIP}/reassign`]: () => envelope(threeStops) })
    renderScreen(<TripOperationsCard tripId={TRIP} />)

    expect(await screen.findByRole('button', { name: 'Reassign' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Re-sequence' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reassign' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reassign REF-07 · Trip 1' })
    expect(within(dialog).getByText('The driver reported a breakdown.')).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: 'DRY-31' })).toBeDisabled()
    expect(within(dialog).getByText('Needs a reefer')).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: 'REF-03' })).toBeChecked()

    await pickReason(user, dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Reassign and notify' }))
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/reassign'))).toBe(true))
    expect(calls.find((c) => c.path.endsWith('/reassign'))?.body).toEqual({ vehicleId: 'veh-ref3', reasonCode: 'VEHICLE_BREAKDOWN' })
  })

  it('AC-PLN-38 shows the projected arrival and spare for each stop as the order changes', async () => {
    const user = userEvent.setup()
    const { calls } = stub({ resequence: link('resequence') })
    renderScreen(<TripOperationsCard tripId={TRIP} />)

    await user.click(await screen.findByRole('button', { name: 'Re-sequence' }))
    const dialog = await screen.findByRole('dialog', { name: 'Re-sequence REF-07 stops' })
    const first = within(dialog).getByRole('row', { name: 'Kandana' })
    expect(await within(first).findByText('14 min spare')).toBeInTheDocument()
    expect(within(first).getByText('At risk')).toBeInTheDocument()
    expect(within(within(dialog).getByRole('row', { name: 'Seeduwa' })).getByText('10 min late')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Move Ja-Ela up' }))
    await waitFor(() =>
      expect(calls.filter((c) => c.path.endsWith('/resequence/preview')).at(-1)?.body).toEqual({ stopIds: ['stop-2', 'stop-1', 'stop-3'] }),
    )
    // No Defer… without the trip's deferStop link.
    expect(within(dialog).queryByRole('button', { name: 'Defer…' })).not.toBeInTheDocument()
  })

  it('AC-PLN-25 defers one stop with a reason and the trip’s version', async () => {
    const user = userEvent.setup()
    const { calls } = stub(
      { resequence: link('resequence'), deferStop: { ...link('stops/{stopId}/defer'), templated: true } },
      { [`POST /api/v1/trips/${TRIP}/stops/stop-2/defer`]: () => envelope(threeStops) },
    )
    renderScreen(<TripOperationsCard tripId={TRIP} />)

    await user.click(await screen.findByRole('button', { name: 'Re-sequence' }))
    const dialog = await screen.findByRole('dialog', { name: 'Re-sequence REF-07 stops' })
    await user.click(within(within(dialog).getByRole('row', { name: 'Ja-Ela' })).getByRole('button', { name: 'Defer…' }))
    const defer = await screen.findByRole('dialog', { name: 'Defer Ja-Ela' })
    await user.click(within(defer).getByRole('combobox', { name: 'Reason' }))
    await user.click(await screen.findByRole('option', { name: 'Vehicle breakdown' }))
    await user.type(within(defer).getByRole('textbox'), 'Road closed')
    await user.click(within(defer).getByRole('button', { name: 'Defer stop' }))

    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/stops/stop-2/defer'))).toBe(true))
    const sent = calls.find((c) => c.path.endsWith('/stops/stop-2/defer'))
    expect(sent?.body).toEqual({ reasonCode: 'VEHICLE_BREAKDOWN', note: 'Road closed' })
    expect(sent?.headers['if-match']).toBe('W/"4"')
  })

  it('AC-PLN-37 a driver-only reassign keeps the vehicle and sends the new driver', async () => {
    const user = userEvent.setup()
    const { calls } = stub({ reassign: link('reassign') }, { [`POST /api/v1/trips/${TRIP}/reassign`]: () => envelope(threeStops) })
    renderScreen(<TripOperationsCard tripId={TRIP} />)

    await user.click(await screen.findByRole('button', { name: 'Reassign' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reassign REF-07 · Trip 1' })
    await user.click(within(dialog).getByRole('radio', { name: 'Keep REF-07' }))
    await user.click(within(dialog).getByRole('combobox', { name: 'Driver' }))
    await user.click(await screen.findByRole('option', { name: /Nuwan Gunasekara · on shift, no trip/ }))
    await pickReason(user, dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Reassign and notify' }))

    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/reassign'))).toBe(true))
    expect(calls.find((c) => c.path.endsWith('/reassign'))?.body).toEqual({ driverId: 'drv-nuwan', reasonCode: 'VEHICLE_BREAKDOWN' })
  })

  it('AC-PLN-06 the repair shows the engine’s verdict for each vehicle', async () => {
    const user = userEvent.setup()
    stub(
      { reassign: link('reassign') },
      {
        [`GET /api/v1/trips/${TRIP}/repair-options`]: () =>
          page([
            { vehicleId: 'veh-ref3', code: 'REF-03', tripNo: 2, fits: false, rules: ['WINDOW_OUTLET'], messages: ['A misses its window', 'B misses its window'] },
            { vehicleId: 'veh-dry', code: 'DRY-31', tripNo: 1, fits: false, rules: ['TEMP_REEFER'], messages: ['Needs a reefer'] },
          ]),
      },
    )
    renderScreen(<TripOperationsCard tripId={TRIP} />)

    await user.click(await screen.findByRole('button', { name: 'Reassign' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reassign REF-07 · Trip 1' })
    // REF-03 has the room, but the engine says its second run misses two windows.
    expect(await within(dialog).findByText('Misses 2 windows')).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: 'REF-03' })).toBeDisabled()
    expect(within(dialog).getByRole('radio', { name: 'Keep REF-07' })).toBeChecked()
  })

  it('shows nothing for a trip with neither link', async () => {
    stub({})
    renderScreen(<TripOperationsCard tripId={TRIP} />)
    await waitFor(() => expect(screen.queryByText('Change this trip')).not.toBeInTheDocument())
  })
})
