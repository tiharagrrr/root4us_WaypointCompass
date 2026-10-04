import type { TrackingDayDto, TrackingStopDto, TrackingTripDto } from '@compass/api-client'
import { act, renderHook, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { eventBus } from '@/realtime/event-bus'
import { envelope, renderScreen, stubApi } from '@/test/api-stub'
import { LiveMap } from '../live-map'
import { mapModel } from '../map-model'
import { useLivePositions } from '../use-live-positions'

// WebGL doesn't exist in jsdom; the canvas is the browser's business, the model is ours.
vi.mock('../map-canvas', () => ({ MapCanvas: () => <div data-testid="map-canvas" /> }))

const stop = (n: number, over: Partial<TrackingStopDto> = {}): TrackingStopDto => ({
  stopId: `s${n}`,
  seq: n,
  orderNo: `WF-017${n}`,
  outletId: `OUT0${n}`,
  outletName: ['Fresh Kadawatha', 'Fresh Ja-Ela', 'Fresh Ragama'][n - 1] ?? `Outlet ${n}`,
  at: { lat: Number((7 + n / 100).toFixed(2)), lng: Number((79.9 + n / 100).toFixed(2)) },
  status: 'PENDING',
  windowOpenMin: 420,
  windowCloseMin: 480,
  plannedArrivalAt: null,
  etaAt: null,
  spareMin: 25,
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
  nextEtaAt: null,
  nextOutletName: null,
  nextWindowOpenMin: null,
  nextWindowCloseMin: null,
  plannedDepartAt: null,
  loadWeightKg: 3420,
  loadVolumeM3: 15.8,
  position: { lat: 7.015, lng: 79.915, heading: 10, speedKmh: 30, recordedAt: '2026-10-02T07:20:00+05:30' },
  lastSignalAt: '2026-10-02T07:20:00+05:30',
  noSignalSince: null,
  stops: [
    stop(1, { status: 'DELIVERED', standing: 'DELIVERED', spareMin: null }),
    stop(2, { standing: 'NEXT', spareMin: 25 }),
    stop(3, { standing: 'LATE', spareMin: -22 }),
  ],
  ...over,
})

const day = (trips: TrackingTripDto[]): TrackingDayDto => ({
  depotId: 'PLG',
  date: '2026-10-02',
  planId: 'p1',
  planStatus: 'PUBLISHED',
  depot: { lat: 6.9608, lng: 79.8847 },
  totals: { trips: trips.length, onRoad: 1, released: 1, stopsPlanned: 3, stopsDelivered: 1, lateRisk: 1, deferred: 0, repeatSkips: 0 },
  trips,
  _links: { self: { href: '/x' } },
})

describe('19 and 19a: the live map', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('AC-EXE-23 draws every trip on the road, and the selected trip with spare time per stop', () => {
    const silent = trip({ tripId: 't2', vehicleCode: 'DRY-31', noSignalSince: '2026-10-02T06:31:00+05:30', position: { lat: 6.9, lng: 79.95, heading: null, speedKmh: null, recordedAt: '2026-10-02T06:31:00+05:30' } })
    const loading = trip({ tripId: 't3', vehicleCode: 'DRY-14', status: 'LOADING', position: null })
    const model = mapModel(day([trip(), silent, loading]), 'Peliyagoda', new Map(), 't1')

    expect(model.depot).toEqual({ at: [79.8847, 6.9608], label: 'Peliyagoda depot' })
    expect(model.vehicles.map((v) => [v.label, v.tone, v.selected])).toEqual([
      ['REF-07 · 1/3', 'vehicle', true],
      ['DRY-31 · 1/3', 'no-signal', false],
    ])
    expect(model.stops.map((s) => [s.tone, s.label])).toEqual([
      ['delivered', null],
      ['upcoming', 'Ja-Ela · 25 min spare'],
      ['late', 'Ragama · +22 min'],
    ])
    // Driven: depot, the delivered stop, the vehicle. Ahead: the vehicle, then the stops to come.
    expect(model.driven).toEqual([[79.8847, 6.9608], [79.91, 7.01], [79.915, 7.015]])
    expect(model.ahead).toEqual([[79.915, 7.015], [79.92, 7.02], [79.93, 7.03]])
    expect(model.bounds).toEqual([[79.8847, 6.9], [79.95, 7.03]])
  })

  it('AC-RT-07 a position from the stream moves the vehicle without refetching', () => {
    const { result } = renderHook(() => useLivePositions())
    act(() =>
      eventBus.emit({
        v: 1,
        type: 'vehicle.position',
        aggregate: { type: 'vehicle', id: 'VEH014' },
        routing: { depotId: 'PLG' },
        data: { tripId: 't1', lat: 7.03, lng: 79.94, heading: 45, recordedAt: '2026-10-02T07:21:00.000Z' },
        occurredAt: '2026-10-02T07:21:00.000Z',
      }),
    )
    const live = result.current
    expect(live.get('t1')).toMatchObject({ lat: 7.03, lng: 79.94 })
    // The live position wins over the read's, and a silent trip that speaks up is no longer an estimate.
    const model = mapModel(day([trip({ noSignalSince: '2026-10-02T06:00:00+05:30' })]), 'Peliyagoda', live, null)
    expect(model.vehicles[0]).toMatchObject({ at: [79.94, 7.03], tone: 'vehicle' })
  })

  it('shows the legend in the frame’s words, and says when nothing is on the map', async () => {
    stubApi({ 'GET /api/v1/depots/PLG/tracking': () => envelope({ ...day([]), depot: null }) })
    renderScreen(<LiveMap depotId="PLG" depotName="Peliyagoda" />)

    const legend = screen.getByRole('list', { name: 'Legend' })
    for (const label of ['Vehicle now', 'Delivered', 'Upcoming', 'At risk', 'Projected late', 'Estimate, no signal'])
      expect(within(legend).getByText(label)).toBeInTheDocument()
    expect(await screen.findByText('No trips on the road and no outlets on the map yet.')).toBeInTheDocument()
  })

  it('draws the map once there is something to draw', async () => {
    stubApi({ 'GET /api/v1/depots/PLG/tracking': () => envelope(day([trip()])) })
    renderScreen(<LiveMap depotId="PLG" depotName="Peliyagoda" selectedTripId="t1" />)
    expect(await screen.findByTestId('map-canvas')).toBeInTheDocument()
  })
})
