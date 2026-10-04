import 'fake-indexeddb/auto'
import { screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, page, renderScreen, stubApi } from '@/test/api-stub'
import { PastTripPage } from '../past-trip-page'
import { TripsPage } from '../trips-page'
import { aBundle, STOP_IDS, TRIP_ID } from './fixtures'

const ME = envelope({ id: 'u-aniqa', name: 'Aniqa Razick', role: 'driver', permissions: ['stop:record'] })

/** REF-07 on 30 Sep, the day before the stub's clock (1 Oct), run and finished. */
const aTrip = (over: Record<string, unknown> = {}) => ({
  id: TRIP_ID,
  tripNo: 1,
  status: 'COMPLETED',
  date: '2026-09-30',
  depotId: 'PLG',
  brand: 'FRESH',
  tempClass: 'CHILLED',
  vehicle: { id: 'v1', code: 'REF-07', temp: 'REEFER' },
  stops: 6,
  openStops: 0,
  plannedDepartAt: '2026-09-30T05:45:00+05:30',
  releasedAt: '2026-09-30T05:00:00+05:30',
  downloadedAt: '2026-09-30T05:10:00+05:30',
  startedAt: '2026-09-30T05:47:00+05:30',
  completedAt: '2026-09-30T10:31:00+05:30',
  cantRunReason: null,
  version: 12,
  _links: { self: { href: `/api/v1/trips/${TRIP_ID}` } },
  ...over,
})

const PLANNED = aTrip({
  id: 'trip-2',
  tripNo: 2,
  status: 'PLANNED',
  date: '2026-10-01',
  openStops: 6,
  plannedDepartAt: '2026-10-01T11:30:00+05:30',
  startedAt: null,
  completedAt: null,
})

const aStop = (index: number, over: Record<string, unknown> = {}) => ({
  id: STOP_IDS[index],
  tripId: TRIP_ID,
  seq: index + 1,
  status: 'DELIVERED',
  arrivedAt: '2026-09-30T06:15:00+05:30',
  completedAt: '2026-09-30T06:22:00+05:30',
  outcome: null,
  receiverName: 'Nuwan P.',
  exceptionNote: null,
  unitsDelivered: 12,
  version: 3,
  _links: {},
  ...over,
})

describe('D10 Trips', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists the last 7 days by day, each trip opening its record', async () => {
    const { calls } = stubApi({
      'GET /api/v1/me': () => ME,
      'GET /api/v1/me/trips': () => page([aTrip(), PLANNED]),
    })
    renderScreen(<TripsPage />, '/driver/trips')

    const today = await screen.findByRole('region', { name: 'Today · Thu 1 Oct' })
    const planned = within(today).getByRole('link', { name: /REF-07 · Trip 2/ })
    expect(within(planned).getByText('Departs 11:30 · 6 stops')).toBeInTheDocument()
    expect(within(planned).getByText('PLANNED')).toBeInTheDocument()

    const yesterday = screen.getByRole('region', { name: 'Yesterday · Wed 30 Sep' })
    const done = within(yesterday).getByRole('link', { name: /REF-07 · Trip 1/ })
    expect(within(done).getByText('05:47–10:31 · 6 stops')).toBeInTheDocument()
    expect(within(done).getByText('6 of 6 stops recorded')).toBeInTheDocument()
    expect(done).toHaveAttribute('href', `/driver/trips/${TRIP_ID}`)

    expect(screen.getByText('Aniqa Razick · REF-07')).toBeInTheDocument()
    // No date: the API answers with the whole 7-day window (AC-EXE-02).
    expect(calls.find((c) => c.path === '/api/v1/me/trips')).toBeDefined()
  })

  it('says so when no trip ran in the window', async () => {
    stubApi({ 'GET /api/v1/me': () => ME, 'GET /api/v1/me/trips': () => page([]) })
    renderScreen(<TripsPage />, '/driver/trips')

    expect(await screen.findByText('No trips yet')).toBeInTheDocument()
  })

  it('shows the problem with a retry when the trips cannot load', async () => {
    stubApi({ 'GET /api/v1/me': () => ME })
    renderScreen(<TripsPage />, '/driver/trips')

    expect(await screen.findByRole('button', { name: /try again|retry/i })).toBeInTheDocument()
  })
})

describe('D11 Past trip', () => {
  afterEach(() => vi.unstubAllGlobals())

  const open = () =>
    renderScreen(
      <Routes>
        <Route path="/driver/trips/:id" element={<PastTripPage />} />
        <Route path="/driver/trips" element={<p>Trips list</p>} />
      </Routes>,
      `/driver/trips/${TRIP_ID}`,
    )

  it('shows what each stop got, when, and who took it', async () => {
    const bundle = aBundle()
    const stops = bundle.stops.map((stop, index) => ({ ...stop, status: index === 2 ? 'PARTIAL' : 'DELIVERED' }))
    stubApi({
      [`GET /api/v1/trips/${TRIP_ID}`]: () => envelope(aTrip()),
      [`GET /api/v1/trips/${TRIP_ID}/offline-bundle`]: () => envelope({ ...bundle, stops }),
      ...Object.fromEntries(
        STOP_IDS.map((id, index) => [
          `GET /api/v1/stops/${id}`,
          () =>
            envelope(
              index === 2
                ? aStop(index, { status: 'PARTIAL', receiverName: null, exceptionNote: '2 chicken damaged', completedAt: '2026-09-30T07:21:00+05:30' })
                : aStop(index),
            ),
        ]),
      ),
    })
    open()

    expect(await screen.findByRole('heading', { name: 'REF-07 · Trip 1' })).toBeInTheDocument()
    expect(screen.getByText('Wed 30 Sep · 05:47–10:31')).toBeInTheDocument()
    expect(screen.getByText('05:47 · Peliyagoda')).toBeInTheDocument()

    const first = (await screen.findByText('Fresh Kadawatha')).closest('li') as HTMLElement
    expect(await within(first).findByText('06:22 · Nuwan P.')).toBeInTheDocument()
    expect(within(first).getByText('DELIVERED')).toBeInTheDocument()

    const short = screen.getByText('Fresh Seeduwa').closest('li') as HTMLElement
    expect(await within(short).findByText('07:21 · 2 chicken damaged')).toBeInTheDocument()
    expect(within(short).getByText('PARTIAL')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/driver/trips')
  })

  it('AC-EXE-02 a trip outside her window shows the problem, not a record', async () => {
    stubApi({})
    open()

    expect(await screen.findByRole('button', { name: /try again|retry/i })).toBeInTheDocument()
    expect(screen.queryByText('Stops & proof of delivery')).not.toBeInTheDocument()
  })
})
