import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, renderScreen, stubApi } from '@/test/api-stub'
import { OrderQueuePage } from '../order-queue-page'
import { order } from './fixtures'

const CONFIRMED = order({
  id: 'ord-1',
  orderNo: 'WF-0231',
  status: 'CONFIRMED',
  districtId: 'gampaha',
  brand: 'FRESH',
  outlet: { id: 'OUT014', name: 'Fresh Kadawatha' },
  version: 4,
  _links: {
    self: { href: '/api/v1/orders/ord-1' },
    priority: { href: '/api/v1/orders/ord-1/priority', method: 'PATCH', title: 'Mark urgent', requires: ['If-Match'] },
    cancel: {
      href: '/api/v1/orders/ord-1/cancel',
      method: 'POST',
      title: 'Cancel order',
      requires: ['If-Match', 'Idempotency-Key', 'reasonCode'],
    },
  },
})

/** Same district, another brand: its own group. */
const OTHER_BRAND = order({
  id: 'ord-2',
  orderNo: 'KL-0088',
  status: 'SUBMITTED',
  districtId: 'gampaha',
  brand: 'STYLE',
  outlet: { id: 'OUT021', name: 'Style Ja-Ela' },
  _links: { self: { href: '/api/v1/orders/ord-2' } },
})

/** Another district entirely, and already deferred onto this run. */
const OTHER_DISTRICT = order({
  id: 'ord-3',
  orderNo: 'WF-0312',
  status: 'DEFERRED',
  districtId: 'colombo',
  brand: 'FRESH',
  urgent: true,
  outlet: { id: 'OUT002', name: 'Fresh Nugegoda' },
  _links: { self: { href: '/api/v1/orders/ord-3' } },
})

const queue = (orders: unknown[], extra: Record<string, unknown> = {}) => ({
  'GET /api/v1/orders': () => page(orders),
  ...extra,
})

describe('03 Order queue', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('groups the day’s queue by district and brand', async () => {
    const { calls } = stubApi(queue([CONFIRMED, OTHER_BRAND, OTHER_DISTRICT]))
    renderScreen(<OrderQueuePage />, '/dispatch/orders')

    expect(await screen.findByText('Gampaha · Fresh')).toBeInTheDocument()
    expect(screen.getByText('Gampaha · Style')).toBeInTheDocument()
    expect(screen.getByText('Colombo · Fresh')).toBeInTheDocument()
    expect(screen.getByText('3 orders to plan')).toBeInTheDocument()

    // Only the queue's statuses, sorted the way the groups are read.
    const [list] = calls
    expect(list?.path).toBe('/api/v1/orders')
  })

  it('asks for one delivery day, the queue statuses and district-then-brand order', async () => {
    let asked: URL | undefined
    stubApi({
      'GET /api/v1/orders': (url) => {
        asked = url
        return page([CONFIRMED])
      },
    })
    renderScreen(<OrderQueuePage />, '/dispatch/orders')

    await screen.findByText('Gampaha · Fresh')
    expect(asked?.searchParams.get('filter[status]')).toBe('SUBMITTED,CONFIRMED,DEFERRED')
    expect(asked?.searchParams.get('sort')).toBe('districtId,brand,orderNo')
    expect(asked?.searchParams.get('filter[deliveryDate]')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('shows an action only when the order carries its link', async () => {
    stubApi(queue([CONFIRMED, OTHER_BRAND]))
    renderScreen(<OrderQueuePage />, '/dispatch/orders')

    const withLinks = within(await screen.findByRole('row', { name: /WF-0231/ }))
    expect(withLinks.getByRole('button', { name: 'Mark urgent' })).toBeInTheDocument()
    expect(withLinks.getByRole('button', { name: 'Cancel order' })).toBeInTheDocument()

    // ord-2 carries only self, so the queue offers it nothing.
    const without = within(screen.getByRole('row', { name: /KL-0088/ }))
    expect(without.queryByRole('button', { name: 'Mark urgent' })).not.toBeInTheDocument()
    expect(without.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument()
  })

  it('marks an order urgent with the order’s version as If-Match', async () => {
    const { calls } = stubApi(
      queue([CONFIRMED], {
        'PATCH /api/v1/orders/ord-1/priority': () => page([]),
      }),
    )
    renderScreen(<OrderQueuePage />, '/dispatch/orders')

    await userEvent.click(await screen.findByRole('button', { name: 'Mark urgent' }))

    const patch = calls.find((call) => call.method === 'PATCH')
    expect(patch?.path).toBe('/api/v1/orders/ord-1/priority')
    expect(patch?.body).toEqual({ urgent: true })
    expect(patch?.headers['if-match']).toBe('W/"4"')
  })

  it('cancels with a reason code, the version and an idempotency key', async () => {
    const { calls } = stubApi(
      queue([CONFIRMED], {
        'POST /api/v1/orders/ord-1/cancel': () => page([]),
      }),
    )
    renderScreen(<OrderQueuePage />, '/dispatch/orders')

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel order' }))
    expect(await screen.findByText('Cancel WF-0231?')).toBeInTheDocument()

    // The confirm button waits for a reason.
    const confirm = screen.getByRole('button', { name: 'Cancel order' })
    expect(confirm).toBeDisabled()

    await userEvent.click(screen.getByRole('combobox', { name: 'Reason' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Outlet closed' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel order' }))

    const post = calls.find((call) => call.method === 'POST')
    expect(post?.path).toBe('/api/v1/orders/ord-1/cancel')
    expect(post?.body).toEqual({ reasonCode: 'OUTLET_CLOSED' })
    expect(post?.headers['if-match']).toBe('W/"4"')
    expect(post?.headers['idempotency-key']).toBeTruthy()
  })

  it('says so when the day has nothing to plan', async () => {
    stubApi(queue([]))
    renderScreen(<OrderQueuePage />, '/dispatch/orders')

    expect(await screen.findByText('Nothing to plan for this day')).toBeInTheDocument()
  })

  it('offers a retry when the queue fails to load', async () => {
    stubApi({
      'GET /api/v1/orders': () =>
        new Response(JSON.stringify({ code: 'SERVER_ERROR', status: 500, title: 'Server error' }), {
          status: 500,
          headers: { 'content-type': 'application/problem+json' },
        }),
    })
    renderScreen(<OrderQueuePage />, '/dispatch/orders')

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Server error')
  })
})
