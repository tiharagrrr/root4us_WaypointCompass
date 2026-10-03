import 'fake-indexeddb/auto'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, setSyncPoke } from '@/offline'
import { envelope, page, renderScreen, stubApi } from '@/test/api-stub'
import { TodaysTripPage } from '../todays-trip-page'
import { aBundle, TRIP_ID } from './fixtures'

const ME = envelope({ id: 'u-aniqa', name: 'Aniqa Razick', role: 'driver', permissions: ['stop:record'] })

const aTripSummary = (over: Record<string, unknown> = {}) => ({
  id: TRIP_ID,
  tripNo: 1,
  status: 'RELEASED',
  date: '2026-10-02',
  depotId: 'PLG',
  brand: 'FRESH',
  tempClass: 'CHILLED',
  vehicle: { id: 'v1', code: 'REF-07', temp: 'REEFER' },
  stops: 6,
  openStops: 6,
  plannedDepartAt: '2026-10-02T03:45:00+05:30',
  releasedAt: '2026-10-02T03:00:00+05:30',
  downloadedAt: null,
  startedAt: null,
  completedAt: null,
  cantRunReason: null,
  version: 3,
  _links: {
    self: { href: `/api/v1/trips/${TRIP_ID}` },
    start: { href: `/api/v1/trips/${TRIP_ID}/start`, method: 'POST', title: 'Start trip' },
  },
  ...over,
})

const routes = (over: Record<string, unknown> = {}) => ({
  'GET /api/v1/me': () => ME,
  'GET /api/v1/me/trips': () => page([aTripSummary()]),
  [`GET /api/v1/trips/${TRIP_ID}/offline-bundle`]: () => envelope(aBundle()),
  ...over,
})

beforeEach(async () => {
  setSyncPoke(() => {})
  await db.open()
  await Promise.all([db.trips.clear(), db.stops.clear(), db.stopLines.clear(), db.outbox.clear(), db.meta.clear()])
})

afterEach(() => vi.unstubAllGlobals())

describe('D1 Today’s trip', () => {
  it('AC-EXE-04 downloads the bundle and shows the trip from the phone', async () => {
    stubApi(routes())
    renderScreen(<TodaysTripPage />, '/driver')

    expect(await screen.findByText('REF-07 · Trip 1')).toBeInTheDocument()
    expect(screen.getByText('Saved for offline')).toBeInTheDocument()
    expect(screen.getByText('Stops, items, map and contacts are on this phone.')).toBeInTheDocument()

    // The stop list and its windows come from Dexie, not from the response.
    expect(await screen.findByText('Fresh Kadawatha')).toBeInTheDocument()
    expect(screen.getByText('06:00–08:00')).toBeInTheDocument()
    expect(screen.getByText('+ 2 more stops')).toBeInTheDocument()

    await waitFor(async () => {
      await expect(db.stops.where('tripId').equals(TRIP_ID).count()).resolves.toBe(6)
    })
    const queued = await db.outbox.toArray()
    expect(queued.map((row) => row.event.type)).toEqual(['TRIP_DOWNLOADED'])
  })

  it('AC-EXE-05 a failed download keeps the trip and offers a retry', async () => {
    await db.meta.put({ key: 'lastBundleAt', value: '2026-10-02T03:05:00+05:30' })
    await db.trips.put({
      id: TRIP_ID,
      tripRef: 'REF-07 · Trip 1',
      status: 'RELEASED',
      vehicleCode: 'REF-07',
      depotId: 'PLG',
      planDate: '2026-10-02',
      departsAt: '2026-10-02T03:45:00+05:30',
      stopCount: 6,
      tempClass: 'CHILLED',
      bundleVersion: 2,
      version: 2,
    })
    stubApi(
      routes({
        [`GET /api/v1/trips/${TRIP_ID}/offline-bundle`]: () =>
          new Response(
            JSON.stringify({ code: 'SERVICE_UNAVAILABLE', status: 503, title: 'Cannot reach the depot' }),
            { status: 503, headers: { 'content-type': 'application/problem+json' } },
          ),
      }),
    )
    renderScreen(<TodaysTripPage />, '/driver')

    // The card the phone already holds stays, and nothing was queued for the failed attempt.
    expect(await screen.findByText('REF-07 · Trip 1')).toBeInTheDocument()
    const failure = await screen.findByRole('alert')
    expect(failure).toHaveTextContent('Download before leaving')
    expect(failure).toHaveTextContent('The trip isn’t fully saved on this phone. Retry on depot Wi-Fi.')
    // The time of the last good download, so she knows what is on board (AC-EXE-05).
    expect(failure).toHaveTextContent('Last saved 03:05')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    // A trip the phone does not hold cannot be started.
    expect(screen.getByRole('button', { name: 'Start trip' })).toBeDisabled()
    await expect(db.outbox.count()).resolves.toBe(0)
  })

  it('AC-EXE-06 Start trip queues TRIP_STARTED through the outbox, never a POST', async () => {
    const { calls } = stubApi(routes())
    renderScreen(<TodaysTripPage />, '/driver')

    await screen.findByText('Fresh Kadawatha')
    await userEvent.click(screen.getByRole('button', { name: 'Start trip' }))

    await waitFor(async () => {
      const queued = await db.outbox.toArray()
      expect(queued.map((row) => row.event.type)).toContain('TRIP_STARTED')
    })
    await expect(db.trips.get(TRIP_ID)).resolves.toMatchObject({ status: 'IN_PROGRESS' })
    expect(calls.filter((call) => call.method === 'POST')).toEqual([])
  })

  it('AC-EXE-07 offers no Start on a trip that is not released', async () => {
    const loading = aBundle()
    loading.trip.status = 'LOADING'
    stubApi(
      routes({
        'GET /api/v1/me/trips': () => page([aTripSummary({ status: 'LOADING', _links: { self: { href: '/x' } } })]),
        [`GET /api/v1/trips/${TRIP_ID}/offline-bundle`]: () => envelope(loading),
      }),
    )
    renderScreen(<TodaysTripPage />, '/driver')

    await screen.findByText('REF-07 · Trip 1')
    expect(screen.queryByRole('button', { name: 'Start trip' })).not.toBeInTheDocument()
  })

  it('AC-EXE-01 shows the empty state when she has no trip today', async () => {
    stubApi(routes({ 'GET /api/v1/me/trips': () => page([]) }))
    renderScreen(<TodaysTripPage />, '/driver')

    expect(await screen.findByText('No trip today')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start trip' })).not.toBeInTheDocument()
  })
})

describe('D8 Can’t run this trip', () => {
  it('AC-EXE-14 sends CANT_RUN with its reason and marks it urgent', async () => {
    const poke = vi.fn()
    setSyncPoke(poke)
    stubApi(routes())
    renderScreen(<TodaysTripPage />, '/driver')

    await screen.findByText('Fresh Kadawatha')
    await userEvent.click(screen.getByRole('button', { name: 'Can’t run this trip?' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('REF-07 · Trip 1 · departs 03:45')).toBeInTheDocument()

    // No reason, no send: the server's own message, before the phone has any signal.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send to dispatcher' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('A reason is required')

    await userEvent.click(within(dialog).getByRole('radio', { name: 'Vehicle breakdown' }))
    await userEvent.type(within(dialog).getByLabelText('Note'), 'Alternator gone')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send to dispatcher' }))

    await waitFor(async () => {
      const queued = await db.outbox.toArray()
      expect(queued.map((row) => row.event.type)).toContain('CANT_RUN')
    })
    const row = (await db.outbox.toArray()).at(-1)
    expect(row?.event).toMatchObject({ type: 'CANT_RUN', reasonCode: 'BREAKDOWN', note: 'Alternator gone' })
    // It leaves at once rather than waiting for the next batch.
    expect(poke).toHaveBeenLastCalledWith({ urgent: true })
  })
})
