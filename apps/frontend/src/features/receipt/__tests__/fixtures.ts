import type { IssueDto, LinkDto, ReceiptDto } from '@compass/api-client'

export const ORDER_ID = '0192a3f4-0000-7000-8000-00000000a001'
export const ISSUE_ID = '0192a3f4-0000-7000-8000-00000000d001'

const link = (href: string, method?: LinkDto['method'], requires?: string[]): LinkDto => ({
  href,
  ...(method ? { method } : {}),
  ...(requires ? { requires } : {}),
})

const lines = [
  { orderLineId: 'l1', itemId: 'i1', sku: 'FR-1', name: 'Basmati rice 5 kg', packLabel: 'Bag ×4', qtyExpected: 12, qtyDelivered: 12, qtyReceived: null, condition: null },
  { orderLineId: 'l2', itemId: 'i2', sku: 'FR-2', name: 'Coconut oil 1 L', packLabel: 'Case ×12', qtyExpected: 8, qtyDelivered: 8, qtyReceived: null, condition: null },
  { orderLineId: 'l3', itemId: 'i3', sku: 'FR-3', name: 'Wheat flour 1 kg', packLabel: 'Case ×10', qtyExpected: 10, qtyDelivered: 10, qtyReceived: null, condition: null },
] satisfies ReceiptDto['lines']

/** A delivered order the store has not yet confirmed: M5's starting point (the frame's WF-0218). */
export const receipt = (over: Partial<ReceiptDto> = {}): ReceiptDto => ({
  id: ORDER_ID,
  orderId: ORDER_ID,
  orderNo: 'WF-0218',
  receiptId: null,
  status: 'PENDING',
  orderStatus: 'DELIVERED',
  stopStatus: 'DELIVERED',
  etaAt: '2026-10-02T07:30:00+05:30',
  awaitingDriverSync: false,
  note: null,
  confirmedAt: null,
  confirmedById: null,
  version: 8,
  lines,
  proof: {
    receiverName: 'Chathura (store staff)',
    deliveredAt: '2026-10-02T07:48:00+05:30',
    signature: { id: 'sig-1', href: '/api/v1/attachments/sig-1' },
    photo: { id: 'photo-1', href: '/api/v1/attachments/photo-1' },
  },
  issueIds: [],
  _links: {
    self: link(`/api/v1/orders/${ORDER_ID}/receipt`),
    confirm: link(`/api/v1/orders/${ORDER_ID}/receipt`, 'POST', ['If-Match', 'Idempotency-Key']),
    reportIssue: link('/api/v1/issues', 'POST', ['If-Match', 'Idempotency-Key']),
  },
  ...over,
})

/** The same order after the store confirmed it: no confirm link, a report link, version moved on. */
export const confirmed = (over: Partial<ReceiptDto> = {}): ReceiptDto =>
  receipt({
    receiptId: 'rcpt-1',
    status: 'CONFIRMED',
    orderStatus: 'RECEIVED',
    confirmedAt: '2026-10-02T09:10:00+05:30',
    version: 9,
    lines: lines.map((l) => ({ ...l, qtyReceived: l.qtyDelivered, condition: 'ok' as const })),
    _links: {
      self: link(`/api/v1/orders/${ORDER_ID}/receipt`),
      reportIssue: link('/api/v1/issues', 'POST', ['If-Match', 'Idempotency-Key']),
    },
    ...over,
  })

export const issue = (over: Partial<IssueDto> = {}): IssueDto => ({
  id: ISSUE_ID,
  outletId: 'OUT014',
  orderId: ORDER_ID,
  orderNo: 'WF-0218',
  stopId: null,
  receiptId: null,
  orderLineId: 'l3',
  type: 'SHORT',
  qtyAffected: 2,
  description: 'Two cases missing from the pallet.',
  status: 'OPEN',
  resolution: null,
  resolutionNote: null,
  raisedById: 'u-nimesha',
  raisedByRole: 'store_manager',
  resolvedById: null,
  createdAt: '2026-10-02T09:10:00+05:30',
  resolvedAt: null,
  photos: [],
  _links: {
    self: link(`/api/v1/issues/${ISSUE_ID}`),
    comments: link(`/api/v1/issues/${ISSUE_ID}/comments`),
    comment: link(`/api/v1/issues/${ISSUE_ID}/comments`, 'POST'),
  },
  ...over,
})
