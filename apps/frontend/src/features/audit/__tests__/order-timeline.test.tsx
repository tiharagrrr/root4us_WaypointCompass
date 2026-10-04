import type { TimelineEntryDto } from '@compass/api-client'
import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, renderScreen, stubApi } from '@/test/api-stub'
import { OrderTimelineDialog } from '../order-timeline-dialog'

const ORDER_ID = '0192a3f4-0000-7000-8000-00000000o001'

const entry = (over: Partial<TimelineEntryDto>): TimelineEntryDto => ({
  id: 'e-1',
  seq: 1,
  action: 'ordering.order.submitted',
  entityType: 'order',
  entityId: ORDER_ID,
  actorId: 'u-1',
  actorName: 'Nimesha Periyapperuma',
  actorRole: 'store_manager',
  deviceId: null,
  source: 'WEB',
  status: null,
  reasonCode: null,
  reasonNote: null,
  occurredAt: '2026-10-01T14:02:11+05:30',
  recordedAt: '2026-10-01T14:02:11+05:30',
  syncedLate: false,
  _links: {},
  ...over,
})

const open = () => renderScreen(<OrderTimelineDialog orderId={ORDER_ID} orderNo="WF-0171" onClose={() => {}} />, '/')

describe('the order timeline', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('AC-AUD-03 lists each step with who, when, device and reason, and marks a late sync', async () => {
    stubApi({
      [`GET /api/v1/timelines/order/${ORDER_ID}`]: () =>
        page([
          entry({}),
          entry({ id: 'e-2', seq: 2, action: 'ordering.order.status_changed', status: 'PLANNED', actorName: null, actorRole: null, source: 'SYSTEM' }),
          entry({
            id: 'e-3',
            seq: 3,
            action: 'execution.stop.partial',
            entityType: 'stop',
            actorName: 'Aniqa Razick',
            actorRole: 'driver',
            deviceId: 'dev-7f3a91c2',
            source: 'OFFLINE_SYNC',
            reasonCode: 'DAMAGED',
            reasonNote: '2 cases crushed',
            occurredAt: '2026-10-02T04:22:00+05:30',
            recordedAt: '2026-10-02T04:31:00+05:30',
            syncedLate: true,
          }),
        ]),
    })
    open()

    const dialog = await screen.findByRole('dialog', { name: 'Order timeline' })
    expect(within(dialog).getByText('Order #WF-0171')).toBeInTheDocument()
    const steps = await within(dialog).findAllByRole('listitem')
    expect(steps).toHaveLength(3)

    expect(within(steps[0]).getByText('Order submitted')).toBeInTheDocument()
    expect(within(steps[0]).getByText('Nimesha Periyapperuma · Store')).toBeInTheDocument()
    expect(within(steps[0]).getByText(/14:02:11/)).toBeInTheDocument()
    expect(within(steps[0]).queryByText(/Synced late/)).not.toBeInTheDocument()

    expect(within(steps[1]).getByText('Order: Planned')).toBeInTheDocument()
    expect(within(steps[1]).getByText('System')).toBeInTheDocument()

    expect(within(steps[2]).getByText('Partly delivered')).toBeInTheDocument()
    expect(within(steps[2]).getByText('Aniqa Razick · Driver · Offline sync · Device dev-7f3a')).toBeInTheDocument()
    expect(within(steps[2]).getByText('Synced late · 04:31')).toBeInTheDocument()
    expect(within(steps[2]).getByText('Reason: Damaged · 2 cases crushed')).toBeInTheDocument()
  })

  it('says so when nothing is recorded yet', async () => {
    stubApi({ [`GET /api/v1/timelines/order/${ORDER_ID}`]: () => page([]) })
    open()

    expect(await screen.findByText('Nothing recorded yet')).toBeInTheDocument()
  })

  it('shows the error with a retry when the timeline cannot be read', async () => {
    stubApi({})
    open()

    expect(await screen.findByRole('button', { name: /try again|retry/i })).toBeInTheDocument()
  })
})
