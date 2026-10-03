import type { LinkDto, LoadFlagDto, LoadLineDto, LoadListDto, LoadStopDto, LoadTripSummaryDto } from '@compass/api-client'

export const TRIP_ID = '0192f3a0-0000-7000-8000-00000000ref7'
export const DEPOT_ID = 'PLG'

const link = (href: string, title: string): LinkDto => ({ href, title, method: 'POST' })

export const aLine = (over: Partial<LoadLineDto> = {}): LoadLineDto => ({
  id: 'line-milk',
  tripId: TRIP_ID,
  orderId: 'order-seeduwa',
  orderLineId: 'ol-1',
  stopSeq: 8,
  status: 'PENDING',
  qtyExpected: 14,
  qtyLoaded: null,
  planRevision: 1,
  orderNo: 'WF-0171',
  outletId: 'outlet-seeduwa',
  outletName: 'Fresh Seeduwa',
  sku: 'MLK-1L',
  itemName: 'Fresh milk 1 L',
  packLabel: null,
  checkedByName: null,
  checkedByUserId: null,
  checkedAt: null,
  flags: [],
  _links: {
    self: { href: `/api/v1/load-lines/line-milk` },
    check: link(`/api/v1/trips/${TRIP_ID}/load-list/checks`, 'Tick'),
    flag: link(`/api/v1/trips/${TRIP_ID}/load-flags`, 'Flag an item'),
  },
  ...over,
})

export const aCheckedLine = (over: Partial<LoadLineDto> = {}): LoadLineDto =>
  aLine({
    id: 'line-rice',
    sku: 'RIC-5K',
    itemName: 'Basmati rice 5 kg',
    qtyExpected: 12,
    qtyLoaded: 12,
    status: 'OK',
    checkedByName: 'Harini De Mel',
    _links: {
      self: { href: '/api/v1/load-lines/line-rice' },
      undo: link('/api/v1/load-lines/line-rice/undo', 'Undo'),
    },
    ...over,
  })

export const aFlag = (over: Partial<LoadFlagDto> = {}): LoadFlagDto => ({
  id: 'flag-1',
  tripId: TRIP_ID,
  loadLineId: 'line-milk',
  reason: 'MISSING',
  qtyAffected: 2,
  note: '2 cases missing',
  status: 'OPEN',
  decision: null,
  decisionNote: null,
  decidedById: null,
  decidedAt: null,
  raisedByName: 'Harini De Mel',
  raisedByUserId: 'user-harini',
  raisedAt: '2026-10-02T03:05:00+05:30',
  resolvedAt: null,
  _links: { self: { href: '/api/v1/load-flags/flag-1' }, undo: link('/api/v1/load-flags/flag-1/undo', 'Undo') },
  ...over,
})

export const aStop = (over: Partial<LoadStopDto> = {}): LoadStopDto => ({
  stopSeq: 8,
  orderId: 'order-seeduwa',
  orderNo: 'WF-0171',
  outletId: 'outlet-seeduwa',
  outletName: 'Seeduwa',
  outstanding: 1,
  lines: [aLine()],
  ...over,
})

/** REF-07 trip 1: two stops, the last one first, as the server returns them (AC-LOD-01). */
export const aLoadList = (over: Partial<LoadListDto> = {}): LoadListDto => ({
  trip: {
    id: TRIP_ID,
    planId: 'plan-1',
    depotId: DEPOT_ID,
    date: '2026-10-02',
    vehicleId: 'REF-07',
    driverId: 'driver-aniqa',
    status: 'LOADING',
    tempClass: 'CHILLED',
    waveId: 'wave-fresh',
    plannedDepartAt: '2026-10-02T05:45:00+05:30',
    releasedAt: null,
    releaseTempC: null,
    planRevision: 1,
  },
  stops: [
    aStop(),
    aStop({
      stopSeq: 7,
      orderId: 'order-jaela',
      orderNo: 'WF-0172',
      outletId: 'outlet-jaela',
      outletName: 'Ja-Ela',
      outstanding: 0,
      lines: [aCheckedLine({ stopSeq: 7, orderId: 'order-jaela', orderNo: 'WF-0172', outletName: 'Ja-Ela' })],
    }),
  ],
  progress: { lines: 2, checked: 1, outstanding: 1, openFlags: 0 },
  listRevision: 1,
  upToDate: true,
  releasedByName: null,
  releaseChecks: [],
  _links: {
    self: { href: `/api/v1/trips/${TRIP_ID}/load-list` },
    release: link(`/api/v1/trips/${TRIP_ID}/release`, 'Release trip'),
  },
  ...over,
})

export const aTripSummary = (over: Partial<LoadTripSummaryDto> = {}): LoadTripSummaryDto => ({
  id: TRIP_ID,
  planId: 'plan-1',
  depotId: DEPOT_ID,
  date: '2026-10-02',
  vehicleId: 'REF-07',
  driverId: 'driver-aniqa',
  status: 'LOADING',
  tempClass: 'CHILLED',
  waveId: 'wave-fresh',
  plannedDepartAt: '2026-10-02T05:45:00+05:30',
  releasedAt: null,
  releaseTempC: null,
  planRevision: 1,
  outletCount: 8,
  progress: { lines: 42, checked: 18, outstanding: 24, openFlags: 0 },
  _links: { self: { href: `/api/v1/trips/${TRIP_ID}/load-list` } },
  ...over,
})

export const releaseChecks = (over: Record<string, unknown> = {}) => ({
  tripId: TRIP_ID,
  canRelease: false,
  checks: [
    { id: 'LINES_RESOLVED', label: 'All items loaded', pass: true, detail: '42 of 42 ticked or scanned' },
    { id: 'NO_OPEN_FLAG', label: 'Flagged items resolved', pass: true, detail: '1 item removed · partial deferral logged · store told what’s short' },
    { id: 'DRIVER_ASSIGNED', label: 'Driver assigned', pass: true, detail: 'Aniqa Razick' },
    { id: 'REEFER_TEMP', label: 'Reefer temperature check', pass: false, detail: 'Required for chilled loads · target 0–4 °C' },
  ],
  maxReleaseTempC: 5,
  planRevision: 1,
  _links: { self: { href: `/api/v1/trips/${TRIP_ID}/release-checks` }, release: link(`/api/v1/trips/${TRIP_ID}/release`, 'Release trip') },
  ...over,
})

export const aMe = (over: Record<string, unknown> = {}) => ({
  id: 'user-harini',
  name: 'Harini De Mel',
  email: 'harini@waypoint.lk',
  role: 'loader',
  depotId: DEPOT_ID,
  outletId: null,
  status: 'ACTIVE',
  ...over,
})
