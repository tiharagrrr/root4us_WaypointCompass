import type { OfflineBundleDto } from '@compass/api-client'

/**
 * Hand-made REF-07, the trip the execution spec's criteria are written against: 2 Oct 2026, a
 * chilled run out of Peliyagoda. No value here comes from data/seed (test-fixtures skill).
 */
export const TRIP_ID = '0192a3f4-0000-7000-8000-00000000b001'
export const STOP_IDS = [
  '0192a3f4-0000-7000-8000-00000000d001',
  '0192a3f4-0000-7000-8000-00000000d002',
  '0192a3f4-0000-7000-8000-00000000d003',
  '0192a3f4-0000-7000-8000-00000000d004',
  '0192a3f4-0000-7000-8000-00000000d005',
  '0192a3f4-0000-7000-8000-00000000d006',
] as const

interface StopSeed {
  name: string
  open: string
  close: string
  accessNotes?: string | null
  contactName?: string | null
  contactPhone?: string | null
}

const STOPS: readonly StopSeed[] = [
  {
    name: 'Fresh Kadawatha',
    open: '06:00',
    close: '08:00',
    accessNotes: 'Rear dock off Kandy Road. Reverse in; the ramp is on the left.',
    contactName: 'Nimesha Periyapperuma',
    contactPhone: '+94711234567',
  },
  { name: 'Fresh Ja-Ela', open: '06:30', close: '08:30' },
  { name: 'Fresh Seeduwa', open: '07:00', close: '09:00' },
  { name: 'Fresh Negombo Road', open: '07:30', close: '09:30' },
  { name: 'Fresh Katunayake', open: '08:00', close: '10:00' },
  { name: 'Fresh Minuwangoda', open: '08:30', close: '10:30' },
]

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/** One stop with its outlet, window and a three-line order. */
const aBundleStop = (index: number) => {
  const seed = STOPS[index]!
  const id = STOP_IDS[index]!
  return {
    id,
    seq: index + 1,
    status: 'PENDING' as const,
    plannedArrivalAt: `2026-10-02T0${4 + index}:10:00+05:30`,
    plannedServiceMin: 12,
    window: { open: seed.open, openMin: toMinutes(seed.open), close: seed.close, closeMin: toMinutes(seed.close) },
    outlet: {
      id: `outlet-${index + 1}`,
      name: seed.name,
      address: `${100 + index} Kandy Road`,
      lat: 7.0 + index / 100,
      lng: 79.9 + index / 100,
      dockType: 'REAR_DOCK' as const,
      parkingConstraint: 'NORMAL' as const,
      accessNotes: seed.accessNotes ?? null,
      contactName: seed.contactName ?? null,
      contactPhone: seed.contactPhone ?? null,
    },
    order: {
      id: `order-${index + 1}`,
      orderNo: `WF-02${10 + index}`,
      tempClass: 'CHILLED' as const,
      units: 24,
      lines: [
        { id: `${id}-l1`, itemId: 'item-1', sku: 'MLK-1L', name: 'Fresh milk 1 L', packLabel: '12 × 1 L', qty: 10 },
        { id: `${id}-l2`, itemId: 'item-2', sku: 'YOG-500', name: 'Set yoghurt 500 g', packLabel: '6 × 500 g', qty: 6 },
        { id: `${id}-l3`, itemId: 'item-3', sku: 'BTR-250', name: 'Butter 250 g', packLabel: '20 × 250 g', qty: 8 },
      ],
    },
  }
}

export const aBundle = (over: Partial<OfflineBundleDto> = {}): OfflineBundleDto => ({
  trip: {
    id: TRIP_ID,
    tripNo: 1,
    date: '2026-10-02',
    status: 'RELEASED',
    brand: 'FRESH',
    tempClass: 'CHILLED',
    depotId: 'PLG',
    districtId: 'gampaha',
    vehicle: { id: 'vehicle-ref-07', code: 'REF-07', temp: 'REEFER' },
    plannedDepartAt: '2026-10-02T03:45:00+05:30',
  },
  stops: STOPS.map((_, index) => aBundleStop(index)),
  version: 3,
  hash: 'f2a1c0de9b7e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4',
  generatedAt: '2026-10-02T03:05:00+05:30',
  ...over,
})
