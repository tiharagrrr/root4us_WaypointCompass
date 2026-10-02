import type { AlertDto } from '@compass/api-client'

const TRIP = '0192a3f4-1111-7000-8000-000000000001'
const FLAG = '0192a3f4-2222-7000-8000-000000000002'

/**
 * One alert as the API returns it. The default is the loader shortfall from
 * AC-ALR-07: open, critical, with the one fix link a dispatcher holding
 * `load:decide` is offered.
 */
export const anAlert = (over: Partial<AlertDto> = {}): AlertDto => ({
  id: '0192a3f4-0000-7000-8000-000000000000',
  type: 'LOADER_SHORTFALL',
  status: 'OPEN',
  severity: 1,
  severityLabel: 'Critical',
  title: 'Load shortfall on a trip about to leave',
  depotId: 'PLG',
  detail: { reason: 'MISSING', minutesToDeparture: 25 },
  dedupeKey: `LOADER_SHORTFALL:load_flag:${FLAG}`,
  tripId: TRIP,
  stopId: null,
  orderId: null,
  outletId: null,
  raisedById: null,
  raisedAt: '2026-10-02T04:50:00+05:30',
  acknowledgedById: null,
  acknowledgedAt: null,
  resolvedById: null,
  resolvedAt: null,
  resolution: null,
  resolvesWhen: 'the flag is decided',
  _links: {
    self: { href: '/api/v1/alerts/0192a3f4-0000-7000-8000-000000000000' },
    decide: {
      href: `/api/v1/load-flags/${FLAG}/decision`,
      method: 'POST',
      title: 'Decide the flag',
      requires: ['decision', 'reasonCode'],
    },
    acknowledge: {
      href: '/api/v1/alerts/0192a3f4-0000-7000-8000-000000000000/acknowledge',
      method: 'POST',
      title: "I'm on it",
    },
    resolve: {
      href: '/api/v1/alerts/0192a3f4-0000-7000-8000-000000000000/resolve',
      method: 'POST',
      title: 'Resolve',
      requires: ['note'],
    },
  },
  ...over,
})

/** A late-risk alert on a trip, whose fix is a screen the app already has. */
export const aLateRisk = (over: Partial<AlertDto> = {}): AlertDto =>
  anAlert({
    id: '0192a3f4-0000-7000-8000-00000000000a',
    type: 'LATE_RISK',
    severity: 2,
    severityLabel: 'Warning',
    title: 'Behind the delivery window by 10 min',
    detail: { lateRisk: 0.98, minutesLate: 10 },
    dedupeKey: 'LATE_RISK:stop:0192a3f4-3333-7000-8000-000000000003',
    stopId: '0192a3f4-3333-7000-8000-000000000003',
    resolvesWhen: 'the late risk falls back under the threshold',
    _links: {
      self: { href: '/api/v1/alerts/0192a3f4-0000-7000-8000-00000000000a' },
      resequence: {
        href: `/api/v1/trips/${TRIP}/resequence`,
        method: 'POST',
        title: 'Re-sequence the run',
        requires: ['If-Match', 'stopIds', 'reasonCode'],
      },
      acknowledge: {
        href: '/api/v1/alerts/0192a3f4-0000-7000-8000-00000000000a/acknowledge',
        method: 'POST',
        title: "I'm on it",
      },
      resolve: {
        href: '/api/v1/alerts/0192a3f4-0000-7000-8000-00000000000a/resolve',
        method: 'POST',
        title: 'Resolve',
        requires: ['note'],
      },
    },
    ...over,
  })

export const TRIP_ID = TRIP
export const FLAG_ID = FLAG
