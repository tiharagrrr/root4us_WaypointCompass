import type { TrackingDayDto, TrackingStopDto, TrackingTripDto } from '@compass/api-client'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, renderScreen, stubApi } from '@/test/api-stub'
import { KpiRow, TodaysRuns } from '../day-summary'
import { LiveTripsList } from '../live-trips-list'
import { StopTimeline } from '../stop-timeline'

const stop = (n: number, over: Partial<TrackingStopDto> = {}): TrackingStopDto => ({
  stopId: `s${n}`,
  seq: n,
  orderNo: `WF-01${70 + n}`,
  outletId: `OUT0${n}`,
  outletName: ['Fresh Kadawatha', 'Fresh Ja-Ela', 'Fresh Kandana'][n - 1] ?? `Outlet ${n}`,
  at: null,
  status: 'PENDING',
  windowOpenMin: 360,
  windowCloseMin: 480,
  plannedArrivalAt: `2026-10-02T0${n}:30:00.000Z`,
  etaAt: null,
  spareMin: 30,
  arrivedAt: null,
  completedAt: null,
  standing: 'PLANNED',
  ...over,
})

const trip = (over: Partial<TrackingTripDto> = {}): TrackingTripDto => ({
  tripId: 't1',
  vehicleCode: 'REF-07',
  vehicleType: 'TRUCK',
  vehicleTemp: 'REEFER',
  tripNo: 1,
  driverName: 'Aniqa Razick',
  brand: 'FRESH',
  tempClass: 'CHILLED',
  status: 'IN_PROGRESS',
  standing: 'LATE_RISK',
  cantRunReason: null,
  delivered: 1,
  stopsTotal: 3,
  nextEtaAt: '2026-10-02T02:12:00.000Z',
  nextOutletName: 'Fresh Ja-Ela',
  nextWindowOpenMin: 420,
  nextWindowCloseMin: 480,
  plannedDepartAt: '2026-10-01T23:10:00.000Z',
  loadWeightKg: 3420,
  loadVolumeM3: 15.8,
  position: null,
  lastSignalAt: null,
  noSignalSince: null,
  stops: [
    stop(1, { status: 'DELIVERED', standing: 'DELIVERED', arrivedAt: '2026-10-02T00:38:00.000Z', spareMin: null }),
    stop(2, { standing: 'NEXT', etaAt: '2026-10-02T02:12:00.000Z', spareMin: 25 }),
    stop(3, { standing: 'LATE', etaAt: '2026-10-02T02:44:00.000Z', spareMin: -14 }),
  ],
  ...over,
})

const board = (trips: TrackingTripDto[]): TrackingDayDto => ({
  depotId: 'PLG',
  date: '2026-10-02',
  planId: 'p1',
  planStatus: 'PUBLISHED',
  depot: null,
  totals: { trips: trips.length, onRoad: 1, released: 2, stopsPlanned: 9, stopsDelivered: 4, lateRisk: 1, deferred: 7, repeatSkips: 2 },
  trips,
  _links: { self: { href: '/x' } },
})

const loading = trip({ tripId: 't2', vehicleCode: 'DRY-14', status: 'LOADING', standing: 'LOADING', delivered: 0, stopsTotal: 2, stops: [stop(1), stop(2)] })

describe('01, 19 and 19a: the live day', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('AC-PLN-39 19 lists each trip with its dots, next arrival and progress; a trip opens 19a', async () => {
    const user = userEvent.setup()
    stubApi({ 'GET /api/v1/depots/PLG/tracking': () => envelope(board([trip(), loading])) })
    renderScreen(
      <Routes>
        <Route path="/dispatch/tracking" element={<LiveTripsList depotId="PLG" />} />
        <Route path="/dispatch/trips/:id" element={<p>Trip details</p>} />
      </Routes>,
      '/dispatch/tracking',
    )

    expect(await screen.findByText('2 trips · 1 on the road')).toBeInTheDocument()
    const ref07 = screen.getByRole('button', { name: 'REF-07 trip 1' })
    expect(within(ref07).getByText('Late risk')).toBeInTheDocument()
    expect(within(ref07).getByText('Next ETA 07:42 · window 07:00–08:00')).toBeInTheDocument()
    expect(within(ref07).getByText('1/3')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: 'DRY-14 trip 1' })).getByText('Departs 04:40 · Peliyagoda')).toBeInTheDocument()

    await user.click(ref07)
    expect(await screen.findByText('Trip details')).toBeInTheDocument()
  })

  it('19a shows each stop planned, projected and actual, with where it stands', async () => {
    stubApi({ 'GET /api/v1/depots/PLG/tracking': () => envelope(board([trip()])) })
    renderScreen(<StopTimeline depotId="PLG" tripId="t1" />)

    const timeline = await screen.findByRole('region', { name: 'REF-07 trip 1 stops' })
    const delivered = within(timeline).getByRole('listitem', { name: 'Fresh Kadawatha' })
    expect(within(delivered).getByText('06:08')).toBeInTheDocument()
    expect(within(delivered).getByText('Delivered')).toBeInTheDocument()
    const next = within(timeline).getByRole('listitem', { name: 'Fresh Ja-Ela' })
    expect(within(next).getByText('07:42')).toBeInTheDocument()
    expect(within(next).getByText('25 min spare')).toBeInTheDocument()
    const late = within(timeline).getByRole('listitem', { name: 'Fresh Kandana' })
    expect(within(late).getByText('+14 min')).toBeInTheDocument()
    expect(within(late).getByText('Late')).toBeInTheDocument()
  })

  it('01 shows the KPI row and today’s runs, with the exceptions on their own', async () => {
    const user = userEvent.setup()
    stubApi({ 'GET /api/v1/depots/PLG/tracking': () => envelope(board([trip(), loading])) })
    renderScreen(
      <>
        <KpiRow depotId="PLG" />
        <TodaysRuns depotId="PLG" depotName="Peliyagoda" />
      </>,
    )

    const onRoad = screen.getByRole('region', { name: 'Trips on the road' })
    expect(await within(onRoad).findByText('of 2 released')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Stops delivered' })).getByText('of 9 planned today')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Deferred today' })).getByText('2 repeat skips')).toBeInTheDocument()

    const runs = screen.getByRole('region', { name: "Today's runs" })
    expect(await within(runs).findByRole('row', { name: /DRY-14/ })).toHaveTextContent('dep 04:40')
    await user.click(within(runs).getByRole('radio', { name: /Exceptions/ }))
    expect(within(runs).queryByRole('row', { name: /DRY-14/ })).not.toBeInTheDocument()
    expect(within(runs).getByRole('row', { name: /REF-07/ })).toBeInTheDocument()
  })
})
