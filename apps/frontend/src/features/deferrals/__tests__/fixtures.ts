import type { DeferralDto } from '@compass/api-client'

export const DEFERRAL_ID = '0192a3f4-0000-7000-8000-00000000a101'
export const DEFERRED_ORDER_ID = '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d11'

const self = (id: string) => `/api/v1/deferrals/${id}`

/** A confirmed deferral the store has not answered, as GET /deferrals/{id} shows it to the store. */
export const aDeferral = (over: Partial<DeferralDto> = {}): DeferralDto => {
  const id = over.id ?? DEFERRAL_ID
  return {
    id,
    orderId: DEFERRED_ORDER_ID,
    orderNo: 'WF-0219',
    orderStatus: 'DEFERRED',
    outletId: 'OUT014',
    outletName: 'Fresh Kadawatha',
    planId: '0192a3f4-0000-7000-8000-00000000b201',
    status: 'CONFIRMED',
    source: 'PLANNING',
    reasonCode: 'NO_REEFER_CAPACITY',
    reasonLabel: 'No reefer capacity',
    reasonText: 'No refrigerated vehicle had room for this run.',
    note: 'REF-02 is in the workshop until Wednesday.',
    fromDate: '2026-10-01',
    toDate: '2026-10-02',
    repeatSkip: false,
    partial: false,
    storeResponse: 'AWAITING',
    storeNote: null,
    storeRespondedAt: null,
    decidedAt: '2026-09-30T16:52:00+05:30',
    choice: null,
    bindingRule: null,
    priorityScore: null,
    createdAt: '2026-09-30T16:52:00+05:30',
    _links: {
      self: { href: self(id) },
      order: { href: `/api/v1/orders/${DEFERRED_ORDER_ID}` },
      respond: { href: `${self(id)}/response`, method: 'POST', title: 'Respond', requires: ['Idempotency-Key'] },
    },
    ...over,
  }
}

/** The same deferral after the store answered: no respond link any more. */
export const answered = (over: Partial<DeferralDto> = {}): DeferralDto =>
  aDeferral({
    storeResponse: 'ACKNOWLEDGED',
    storeRespondedAt: '2026-10-01T09:00:00+05:30',
    _links: { self: { href: self(DEFERRAL_ID) }, order: { href: `/api/v1/orders/${DEFERRED_ORDER_ID}` } },
    ...over,
  })
