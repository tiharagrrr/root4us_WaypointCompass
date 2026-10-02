import type { ItemDto, OrderDto, OrderLineDto } from '@compass/api-client'

/**
 * Hand-built orders for the store screens, holding the numbers the M1 frame shows. Build the one
 * the test is about with an override; never reach for the competition data (test-fixtures skill).
 */

const SELF = (id: string) => `/api/v1/orders/${id}`

export const DRY_ID = '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e'
export const CHILLED_ID = '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0f'

export const line = (over: Partial<OrderLineDto> = {}): OrderLineDto => ({
  id: 'l1',
  itemId: 'i1',
  sku: 'FR-1102',
  name: 'Basmati rice 5 kg',
  packLabel: 'Bag ×4',
  qty: 12,
  unitWeightKg: 20,
  unitVolumeM3: 0.03,
  weightKg: 240,
  volumeM3: 0.36,
  available: true,
  _links: {},
  ...over,
})

export const order = (over: Partial<OrderDto> = {}): OrderDto => {
  const id = over.id ?? DRY_ID
  return {
    id,
    orderNo: 'WF-0231',
    status: 'DRAFT',
    tempClass: 'AMBIENT',
    brand: 'FRESH',
    requestedDate: '2026-10-01',
    deliveryDate: '2026-10-01',
    afterCutoff: false,
    urgent: false,
    totals: { lines: 5, units: 40, weightKg: 544, volumeM3: 1.08, valueLkr: null },
    outlet: { id: 'OUT014', name: 'Fresh Kadawatha' },
    deliveryWindow: { openMin: 420, open: '07:00', closeMin: 540, close: '09:00' },
    note: null,
    templateId: null,
    submittedAt: null,
    cancelledAt: null,
    cancelReason: null,
    editableUntil: '2026-10-01T16:00:00+05:30',
    version: 1,
    _links: {
      self: { href: SELF(id) },
      lines: { href: `${SELF(id)}/lines` },
      submit: { href: `${SELF(id)}/submit`, method: 'POST', title: 'Send order', requires: ['If-Match'] },
      addLine: { href: `${SELF(id)}/lines`, method: 'POST', title: 'Add item', requires: ['If-Match'] },
      setLines: { href: `${SELF(id)}/lines`, method: 'PUT', title: 'Replace the lines', requires: ['If-Match'] },
      saveAsTemplate: { href: `${SELF(id)}/save-as-template`, method: 'POST', title: 'Save as preset' },
    },
    ...over,
  }
}

export const chilled = (over: Partial<OrderDto> = {}): OrderDto =>
  order({
    id: CHILLED_ID,
    orderNo: 'WF-0232',
    tempClass: 'CHILLED',
    totals: { lines: 3, units: 30, weightKg: 254, volumeM3: 0.64, valueLkr: null },
    ...over,
  })

export const item = (over: Partial<ItemDto> = {}): ItemDto => ({
  id: 'i-sugar',
  sku: 'FR-1170',
  name: 'Sugar 1 kg',
  brand: 'FRESH',
  category: 'Grains',
  tempClass: 'AMBIENT',
  packLabel: 'Case ×10',
  unitWeightKg: 10,
  unitVolumeM3: 0.02,
  unitValueLkr: null,
  fragile: false,
  active: true,
  _links: {},
  ...over,
})
