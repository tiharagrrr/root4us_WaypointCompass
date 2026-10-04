import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, page, renderScreen, stubApi } from '@/test/api-stub'
import { OrderHistoryPage } from '../order-history-page'
import { order } from './fixtures'

const RECEIVED = order({
  id: 'ord-1',
  orderNo: 'WF-0205',
  status: 'RECEIVED',
  deliveryDate: '2026-09-26',
  _links: {
    self: { href: '/api/v1/orders/ord-1' },
    timeline: { href: '/api/v1/timelines/order/ord-1' },
    reorder: { href: '/api/v1/orders/ord-1/reorder', method: 'POST', title: 'Reorder', requires: ['Idempotency-Key'] },
  },
})
const ISSUE = order({
  id: 'ord-2',
  orderNo: 'WF-0177',
  status: 'ISSUE_REPORTED',
  tempClass: 'CHILLED',
  deliveryDate: '2026-09-22',
  _links: { self: { href: '/api/v1/orders/ord-2' } },
})

const open = () =>
  renderScreen(
    <Routes>
      <Route path="/store/history" element={<OrderHistoryPage />} />
      <Route path="/store/orders/new" element={<p>New order screen</p>} />
    </Routes>,
    '/store/history',
  )

describe('M8 Order history', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists past orders with their status, and offers only the actions an order carries', async () => {
    const asked: URLSearchParams[] = []
    stubApi({
      'GET /api/v1/orders': (url) => {
        asked.push(url.searchParams)
        return page([RECEIVED, ISSUE])
      },
    })
    open()

    const received = (await screen.findByText('#WF-0205')).closest('tr') as HTMLElement
    expect(within(received).getByText('Fresh · Dry')).toBeInTheDocument()
    expect(within(received).getByText('DELIVERED')).toBeInTheDocument()
    expect(within(received).getByRole('button', { name: 'Reorder' })).toBeInTheDocument()
    expect(within(received).getByRole('button', { name: 'Timeline' })).toBeInTheDocument()

    const issue = screen.getByText('#WF-0177').closest('tr') as HTMLElement
    expect(within(issue).getByText('ISSUE')).toBeInTheDocument()
    expect(within(issue).queryByRole('button', { name: 'Reorder' })).not.toBeInTheDocument()
    expect(within(issue).queryByRole('button', { name: 'Timeline' })).not.toBeInTheDocument()

    expect(asked[0].get('filter[status]')).toContain('RECEIVED')
    expect(asked[0].get('sort')).toBe('-deliveryDate')
    expect(asked[0].get('filter[deliveryDate][gte]')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('AC-ORD-07 Reorder posts once with an Idempotency-Key and opens the new draft on M1', async () => {
    const user = userEvent.setup()
    const { calls } = stubApi({
      'GET /api/v1/orders': () => page([RECEIVED]),
      'POST /api/v1/orders/ord-1/reorder': () => envelope(order({ id: 'ord-9', orderNo: 'WF-0240', status: 'DRAFT' })),
    })
    open()

    const row = (await screen.findByText('#WF-0205')).closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Reorder' }))

    expect(await screen.findByText('New order screen')).toBeInTheDocument()
    const posts = calls.filter((c) => c.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(new Headers(posts[0].headers).get('Idempotency-Key')).toBeTruthy()
  })

  it('says so when there are no past orders', async () => {
    stubApi({ 'GET /api/v1/orders': () => page([]) })
    open()

    await waitFor(() => expect(screen.getByText('No past orders')).toBeInTheDocument())
  })
})
