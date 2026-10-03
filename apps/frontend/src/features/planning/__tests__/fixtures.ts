import type { LinkDto, PlanDto, PlanVehicleOptionDto, TripDto, UnplannedOrderDto } from '@compass/api-client'

export const PLAN_ID = '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e'
export const DATE = '2026-10-02'
const write = (href: string, title: string): LinkDto => ({ href, title, method: 'POST', requires: ['If-Match', 'Idempotency-Key'] })

export const aPlan = (over: Partial<PlanDto> = {}): PlanDto => ({
  id: PLAN_ID,
  depotId: 'PLG',
  date: DATE,
  status: 'DRAFT',
  revision: 0,
  version: 7,
  publishOpensAt: '2026-10-01T10:30:00.000Z',
  publishedAt: null,
  publishedById: null,
  closedAt: null,
  summary: { trips: 0, plannedOrders: 0, unplanned: 2, undecided: 2 },
  _links: {
    self: { href: `/api/v1/plans/${PLAN_ID}` },
    edits: write(`/api/v1/plans/${PLAN_ID}/edits`, 'Save changes'),
    engineRuns: write(`/api/v1/plans/${PLAN_ID}/engine-runs`, 'Auto-suggest'),
  },
  ...over,
})

/** Two chilled Fresh orders for Gampaha, each 2 m³. */
export const anUnplanned = (n: number, over: Partial<UnplannedOrderDto> = {}): UnplannedOrderDto => ({
  orderId: `ord-${n}`,
  orderNo: `WF-017${n}`,
  outletId: `out-${n}`,
  outletName: outletOf(n),
  brand: 'FRESH',
  districtId: 'gampaha',
  tempClass: 'CHILLED',
  units: 10,
  weightKg: 1240,
  volumeM3: 2,
  priority: 25,
  repeatSkip: false,
  reasonCode: null,
  reasonLabel: null,
  bindingRule: null,
  choice: null,
  deferralStatus: null,
  deferralId: null,
  note: null,
  toDate: null,
  ...over,
})

const vehicle = (id: string, code: string, temp: 'REEFER' | 'AMBIENT', volumeCapM3 = 18) =>
  ({ id, code, depotId: 'PLG', type: 'TRUCK', temp, weightCapKg: 4000, volumeCapM3, kmPerL: 5, weeklyFuelQuotaL: 400, available: true, unavailableReason: null }) as const

/** One saved Fresh trip for Gampaha in the engine's plan. */
export const aDraftTrip = (orderIds: string[], over: { vehicleId?: string; key?: string; tripNo?: number } = {}) => ({
  key: over.key ?? 'REF-07#1',
  vehicleId: over.vehicleId ?? 'veh-ref',
  tripNo: over.tripNo ?? 1,
  brand: 'FRESH',
  districtId: 'gampaha',
  orderIds,
  locked: true,
})

export interface ContextOptions {
  /** Saved trips in the engine's plan. */
  trips?: ReturnType<typeof aDraftTrip>[]
  /** REF-07's volume, to make a trip over capacity. */
  ref07VolumeM3?: number
  /** Add a second reefer, REF-03, for a fix to move an order to. */
  ref03?: boolean
  /** Order ids the engine's plan leaves unplanned, with their reasons. */
  unplanned?: { orderId: string; repeatSkip?: boolean }[]
  /** How many Fresh orders (ord-1 …), 2 by default. */
  orders?: number
}

const OUTLETS = ['Wattala', 'Ja-Ela', 'Seeduwa', 'Ragama']
export const outletOf = (n: number) => OUTLETS[n - 1] ?? `Outlet ${n}`

const ns = (opts: ContextOptions) => Array.from({ length: opts.orders ?? 2 }, (_, i) => i + 1)

/** An engine context the browser's engine can run on: the shape of GET /plans/{id}/context. */
export const aContext = (opts: ContextOptions = {}) => ({
  planId: PLAN_ID,
  version: 7,
  engineVersion: '0.3.0',
  input: {
    date: DATE,
    isOperatingDay: true,
    vehicles: [
      vehicle('veh-ref', 'REF-07', 'REEFER', opts.ref07VolumeM3),
      vehicle('veh-dry', 'DRY-22', 'AMBIENT'),
      ...(opts.ref03 ? [vehicle('veh-ref3', 'REF-03', 'REEFER')] : []),
    ],
    outlets: Object.fromEntries(
      ns(opts).map((n) => [
        `out-${n}`,
        {
          id: `out-${n}`,
          depotId: 'PLG',
          dockType: 'REAR_DOCK',
          parkingConstraint: 'NORMAL',
          windowOpenMin: 300,
          windowCloseMin: 450,
          mallWindowOpenMin: null,
          mallWindowCloseMin: null,
          styleDeliveryDow: null,
        },
      ]),
    ),
    districts: { gampaha: { id: 'gampaha', name: 'Gampaha', depotToDistrictMin: 37, interStopMin: 9, depotToDistrictKm: 20, interStopKm: 4 } },
    allowances: { 'FRESH:REAR_DOCK': 15 },
    orders: ns(opts).map((n) => ({
      id: `ord-${n}`,
      ref: `WF-017${n}`,
      outletId: `out-${n}`,
      brand: 'FRESH',
      districtId: 'gampaha',
      tempClass: 'CHILLED',
      units: 10,
      weightKg: 1240,
      volumeM3: 2,
      valueLkr: null,
      urgent: false,
    })),
    history: {},
    fuelUsedThisWeek: {},
    fixedTrips: [],
  },
  plan: {
    trips: opts.trips ?? [],
    unplanned: (opts.unplanned ?? []).map((u) => ({
      orderId: u.orderId,
      priority: 25,
      repeatSkip: u.repeatSkip ?? false,
      reasonCode: 'OVER_CAPACITY',
      bindingRule: 'CAP_VOLUME',
      choice: 'UNAVOIDABLE',
    })),
  },
})

export const aVehicleOption = (over: Partial<PlanVehicleOptionDto> = {}): PlanVehicleOptionDto => ({
  vehicleId: 'veh-ref',
  code: 'REF-07',
  type: 'TRUCK',
  temp: 'REEFER',
  status: 'AVAILABLE',
  available: true,
  unavailableReason: null,
  tripsUsed: 0,
  tripsLeft: 2,
  nextTripNo: 1,
  freshMinutesLeft: 270,
  styleTechMinutesLeft: 480,
  weightCapKg: 4000,
  volumeCapM3: 18,
  fuelLeftL: 300,
  weeklyFuelQuotaL: 400,
  ...over,
})

export const aTrip = (over: Partial<TripDto> = {}): TripDto => ({
  id: 'trip-1',
  key: 'REF-07#1',
  planId: PLAN_ID,
  vehicleId: 'veh-ref',
  vehicleCode: 'REF-07',
  driverId: null,
  driverName: null,
  tripNo: 1,
  brand: 'FRESH',
  districtId: 'gampaha',
  districtName: 'Gampaha',
  tempClass: 'CHILLED',
  status: 'PLANNED',
  locked: true,
  isReserved: false,
  waveId: null,
  plannedDepartAt: '2026-10-01T22:00:00.000Z',
  minutes: 76,
  budgetMinutes: 270,
  plannedKm: 44,
  plannedFuelL: 8.8,
  loadWeightKg: 2480,
  loadVolumeM3: 4,
  weightCapKg: 4000,
  volumeCapM3: 18,
  version: 1,
  stops: [1, 2].map((n) => ({
    id: `stop-${n}`,
    tripId: 'trip-1',
    orderId: `ord-${n}`,
    outletId: `out-${n}`,
    outletName: n === 1 ? 'Wattala' : 'Ja-Ela',
    seq: n,
    status: 'PENDING',
    window: { openMin: 300, open: '05:00', closeMin: 450, close: '07:30' },
    plannedArrivalAt: null,
    arrivedAt: null,
    completedAt: null,
    outcome: null,
    receiverName: null,
    exceptionNote: null,
    unitsDelivered: null,
    version: 1,
    _links: { self: { href: `/api/v1/stops/stop-${n}` } },
  })),
  violations: [],
  _links: { self: { href: '/api/v1/trips/trip-1' } },
  ...over,
})
