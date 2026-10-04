import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HeaderSlotContext } from '@/app/layouts/header-slot'
import { envelope, page, renderScreen, stubApi } from '@/test/api-stub'
import { PastOrdersPage } from '../past-orders-page'
import { order } from './fixtures'

const DELIVERED = order({
  id: 'ord-1',
  orderNo: 'WF-0142',
  status: 'RECEIVED',
  tempClass: 'CHILLED',
  deliveryDate: '2026-09-30',
  outlet: { id: 'OUT014', name: 'Fresh Kadawatha' },
  totals: { lines: 4, units: 30, weightKg: 640, volumeM3: 3.2, valueLkr: null },
  _links: { self: { href: '/api/v1/orders/ord-1' }, timeline: { href: '/api/v1/timelines/order/ord-1' } },
})
const FAILED = order({
  id: 'ord-2',
  orderNo: 'WS-0081',
  status: 'FAILED',
  brand: 'STYLE',
  districtId: 'colombo',
  deliveryDate: '2026-09-30',
  outlet: { id: 'OUT031', name: 'Style Maharagama' },
  _links: { self: { href: '/api/v1/orders/ord-2' } },
})

const DEFERRAL = { id: 'def-1', outletName: 'Tech Negombo', outletBrand: 'TECH', reasonLabel: 'Over capacity' }

/** The API's clock reads 1 Oct (api-stub's serverTime), so the screen opens on 30 Sep. */
function stub(orders: unknown[], routes: Record<string, (url: URL) => unknown> = {}) {
  const asked: URLSearchParams[] = []
  const api = stubApi({
    'GET /api/v1/orders': (url) => {
      asked.push(url.searchParams)
      return page(orders)
    },
    'GET /api/v1/deferrals': () => page([DEFERRAL]),
    ...routes,
  })
  return { ...api, asked }
}

function open() {
  const slot = document.createElement('div')
  document.body.appendChild(slot)
  renderScreen(
    <HeaderSlotContext.Provider value={slot}>
      <PastOrdersPage />
    </HeaderSlotContext.Provider>,
    '/dispatch/past-orders',
  )
  return slot
}

describe('04 Past orders', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists yesterday’s orders with their result, and offers the timeline only where the order links it', async () => {
    const { asked } = stub([DELIVERED, FAILED])
    open()

    const delivered = (await screen.findByText('WF-0142')).closest('tr') as HTMLElement
    expect(within(delivered).getByText('Kadawatha')).toBeInTheDocument()
    expect(within(delivered).getByText('Gampaha')).toBeInTheDocument()
    expect(within(delivered).getByText('640')).toBeInTheDocument()
    expect(within(delivered).getByText('3.2')).toBeInTheDocument()
    expect(within(delivered).getByText('Chilled')).toBeInTheDocument()
    expect(within(delivered).getByText('DELIVERED')).toBeInTheDocument()
    expect(within(delivered).getByRole('button', { name: 'Timeline' })).toBeInTheDocument()

    const failed = screen.getByText('WS-0081').closest('tr') as HTMLElement
    expect(within(failed).getByText('FAILED')).toBeInTheDocument()
    expect(within(failed).queryByRole('button', { name: 'Timeline' })).not.toBeInTheDocument()

    await waitFor(() => expect(asked.at(-1)?.get('filter[deliveryDate]')).toBe('2026-09-30'))
    expect(asked.at(-1)?.get('filter[depotId]')).toBe('PLG')
    // Read only: nothing on the screen writes.
    expect(screen.queryByRole('button', { name: /cancel|urgent/i })).not.toBeInTheDocument()
  })

  it('AC-ORD-31 searches by order number or outlet and opens the order’s timeline', async () => {
    const user = userEvent.setup()
    const { asked } = stub([DELIVERED], {
      'GET /api/v1/timelines/order/ord-1': () => envelope([]),
    })
    open()

    await user.type(await screen.findByRole('searchbox', { name: 'Search order or outlet' }), 'kadawatha')
    await waitFor(() => expect(asked.some((p) => p.get('q') === 'kadawatha' && p.get('limit') === '10')).toBe(true))

    const row = (await screen.findByText('WF-0142')).closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Timeline' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Order #WF-0142')).toBeInTheDocument()
  })

  it('steps back a day, and cannot step past yesterday', async () => {
    const user = userEvent.setup()
    const { asked } = stub([DELIVERED])
    const header = open()

    await screen.findByText('WF-0142')
    await waitFor(() => expect(within(header).getByRole('button', { name: 'Next day' })).toBeDisabled())

    await user.click(within(header).getByRole('button', { name: 'Previous day' }))
    await waitFor(() => expect(asked.at(-1)?.get('filter[deliveryDate]')).toBe('2026-09-29'))
    expect(within(header).getByRole('button', { name: 'Next day' })).toBeEnabled()
  })

  it('counts the orders the day deferred from the deferral log, with their reasons', async () => {
    stub([DELIVERED])
    open()

    const moved = await screen.findByRole('region', { name: 'Moved to a later run' })
    expect(await within(moved).findByText('Negombo')).toBeInTheDocument()
    expect(within(moved).getByText('Over capacity')).toBeInTheDocument()
    expect(within(moved).getByRole('link', { name: 'Open in Deferrals' })).toHaveAttribute('href', '/dispatch/deferrals')
  })

  it('says so when the day had no orders', async () => {
    stub([])
    open()

    expect(await screen.findByText('No orders on this day')).toBeInTheDocument()
  })
})
