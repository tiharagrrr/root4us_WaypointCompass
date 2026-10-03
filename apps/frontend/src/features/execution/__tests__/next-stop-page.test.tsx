import 'fake-indexeddb/auto'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, setSyncPoke } from '@/offline'
import { envelope, renderScreen, stubApi } from '@/test/api-stub'
import { NextStopPage } from '../next-stop-page'
import { saveBundle } from '../trip-bundle'
import { aBundle, STOP_IDS, TRIP_ID } from './fixtures'

const OTHER_TRIP = '0192a3f4-0000-7000-8000-00000000b002'

const stopRoutes = (stopId: string, over: Record<string, unknown> = {}) => ({
  [`GET /api/v1/stops/${stopId}`]: () =>
    envelope({
      id: stopId,
      tripId: TRIP_ID,
      orderId: 'order-1',
      outletId: 'outlet-1',
      outletName: 'Fresh Kadawatha',
      seq: 1,
      status: 'PENDING',
      window: { open: '06:00', openMin: 360, close: '08:00', closeMin: 480 },
      plannedArrivalAt: '2026-10-02T04:10:00+05:30',
      arrivedAt: null,
      completedAt: null,
      outcome: null,
      receiverName: null,
      exceptionNote: null,
      unitsDelivered: null,
      version: 3,
      _links: { self: { href: `/api/v1/stops/${stopId}` } },
    }),
  ...over,
})

/** D3 reads :id from the route, so each test renders it behind the real path. */
const renderStop = (stopId: string) =>
  renderScreen(
    <Routes>
      <Route path="/driver/stops/:id" element={<NextStopPage />} />
      <Route path="/driver" element={<p>Today’s trip</p>} />
    </Routes>,
    `/driver/stops/${stopId}`,
  )

const running = async () => {
  await saveBundle(aBundle(), db)
  await db.trips.update(TRIP_ID, { status: 'IN_PROGRESS' })
}

beforeEach(async () => {
  setSyncPoke(() => {})
  await db.open()
  await Promise.all([db.trips.clear(), db.stops.clear(), db.stopLines.clear(), db.outbox.clear(), db.meta.clear()])
})

afterEach(() => vi.unstubAllGlobals())

describe('D3 Next stop', () => {
  it('shows the stop, its window and what comes after it, all from the phone', async () => {
    await running()
    stubApi(stopRoutes(STOP_IDS[0]))
    renderStop(STOP_IDS[0])

    expect(await screen.findByRole('heading', { name: 'Stop 1 of 6' })).toBeInTheDocument()
    expect(screen.getByText('REF-07 · Trip 1')).toBeInTheDocument()
    expect(screen.getByText('Fresh Kadawatha')).toBeInTheDocument()
    expect(screen.getByText('06:00–08:00')).toBeInTheDocument()
    expect(screen.getByText('SHARING LOCATION')).toBeInTheDocument()

    // "Then" lists the next two stops in order.
    expect(screen.getByText('2 · Fresh Ja-Ela')).toBeInTheDocument()
    expect(screen.getByText('3 · Fresh Seeduwa')).toBeInTheDocument()
    expect(screen.queryByText('4 · Fresh Negombo Road')).not.toBeInTheDocument()
  })

  it('AC-EXE-08 Arrived queues ARRIVED with the position and opens the record screen', async () => {
    await running()
    const { calls } = stubApi(stopRoutes(STOP_IDS[2]))
    vi.stubGlobal('navigator', {
      ...navigator,
      onLine: true,
      geolocation: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({ coords: { latitude: 7.08, lng: 0, longitude: 79.95 } } as unknown as GeolocationPosition),
      },
    })
    renderStop(STOP_IDS[2])

    await screen.findByText('Fresh Seeduwa')
    await userEvent.click(screen.getByRole('button', { name: 'Arrived' }))

    await waitFor(async () => {
      const queued = await db.outbox.toArray()
      expect(queued).toHaveLength(1)
      expect(queued[0]?.event).toMatchObject({
        kind: 'driver',
        type: 'ARRIVED',
        tripId: TRIP_ID,
        stopId: STOP_IDS[2],
        baseVersion: 3,
        lat: 7.08,
        lng: 79.95,
      })
    })
    await expect(db.stops.get(STOP_IDS[2])).resolves.toMatchObject({ status: 'ARRIVED' })
    // The field write never touches the API: no POST went out (architecture rule 10).
    expect(calls.filter((call) => call.method === 'POST')).toEqual([])
  })

  it('AC-EXE-08 says so when the stop is taken out of sequence', async () => {
    await running()
    stubApi(stopRoutes(STOP_IDS[2]))
    renderStop(STOP_IDS[2])

    // Stops 1 and 2 are still pending, so this one is out of order — allowed, and shown as such.
    expect(await screen.findByText('Out of sequence')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Arrived' })).toBeInTheDocument()
  })

  it('AC-EXE-02 a stop from another trip is refused', async () => {
    await running()
    await db.stops.put({
      id: 'stop-elsewhere',
      tripId: OTHER_TRIP,
      sequence: 1,
      status: 'PENDING',
      outletId: 'outlet-9',
      outletName: 'Fresh Dehiwala',
      district: 'colombo',
      windowStart: '06:00',
      windowEnd: '08:00',
      lat: null,
      lng: null,
      accessNote: null,
      contactName: null,
      contactPhone: null,
      version: 1,
    })
    stubApi(stopRoutes('stop-elsewhere'))
    renderStop('stop-elsewhere')

    expect(await screen.findByText('That stop is not on this trip')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Arrived' })).not.toBeInTheDocument()
    await expect(db.outbox.count()).resolves.toBe(0)
  })

  it('offers nothing to record while the trip has not been started', async () => {
    await saveBundle(aBundle(), db)
    stubApi(stopRoutes(STOP_IDS[0]))
    renderStop(STOP_IDS[0])

    expect(await screen.findByText('That stop is not on this trip')).toBeInTheDocument()
  })
})
