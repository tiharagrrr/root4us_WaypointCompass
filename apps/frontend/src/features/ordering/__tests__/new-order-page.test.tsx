import { resetServerClock } from '@compass/api-client'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, page, renderScreen, stubApi } from '@/test/api-stub'
import { NewOrderPage } from '../new-order-page'
import { chilled, DRY_ID, item, line, order } from './fixtures'

const linesOf = (orderId: string, lines: unknown[], version = 1) =>
  envelope({ orderId, version, lines, _links: {} })

/** The two drafts of the day, the dry one's five lines, no presets and the Fresh range. */
const day = (overrides: { orders?: unknown[]; lines?: unknown[] } = {}) => ({
  'GET /api/v1/orders': () => page(overrides.orders ?? [order(), chilled()]),
  [`GET /api/v1/orders/${DRY_ID}/lines`]: () => linesOf(DRY_ID, overrides.lines ?? [line()]),
  'GET /api/v1/order-templates': () => page([]),
  'GET /api/v1/items': () => page([item()]),
})

describe('M1 New order', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetServerClock()
  })

  it('shows the day’s two orders, the open one’s lines and what it adds up to', async () => {
    stubApi(day())
    renderScreen(<NewOrderPage />, '/store/orders/new')

    expect(await screen.findByRole('button', { name: /Dry order/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Chilled order/ })).toHaveAttribute('aria-pressed', 'false')
    expect(await screen.findByText('Basmati rice 5 kg')).toBeInTheDocument()
    expect(screen.getByText('5 lines · 40 packs')).toBeInTheDocument()
    expect(screen.getByText('544 kg')).toBeInTheDocument()
    expect(screen.getByText('1.08 m³')).toBeInTheDocument()
    expect(screen.getByText('Thu 1 Oct · 07:00–09:00')).toBeInTheDocument()
  })

  it('counts down to the cutoff from the server’s clock', async () => {
    stubApi(day())
    renderScreen(<NewOrderPage />, '/store/orders/new')

    expect(await screen.findByText('Cutoff 4:00 PM')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/\d+M LEFT/)).toBeInTheDocument())
  })

  it('sends the order with the version it loaded, then moves to the chilled one', async () => {
    const { calls } = stubApi({
      ...day(),
      [`POST /api/v1/orders/${DRY_ID}/submit`]: () =>
        envelope(order({ status: 'SUBMITTED', submittedAt: '2026-10-01T15:12:00+05:30', version: 2 })),
    })
    renderScreen(<NewOrderPage />, '/store/orders/new')

    await userEvent.click(await screen.findByRole('button', { name: 'Send dry order' }))

    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/submit'))).toBe(true))
    const submit = calls.find((c) => c.path.endsWith('/submit'))
    expect(submit?.headers['if-match']).toBe('W/"1"')
    expect(submit?.headers['idempotency-key']).toMatch(/[0-9a-f-]{36}/)
  })

  it('offers no button the order has no link for', async () => {
    const sent = order({ status: 'SUBMITTED', submittedAt: '2026-10-01T14:12:00+05:30', _links: { self: { href: '/x' } } })
    stubApi(day({ orders: [sent, chilled()] }))
    renderScreen(<NewOrderPage />, '/store/orders/new')

    expect(await screen.findByText('Basmati rice 5 kg')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Send/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add item' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save as preset' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Basmati rice 5 kg, packs')).toBeDisabled()
  })
})

describe('M1b Chilled order', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetServerClock()
  })

  it('marks the dry order sent and says where it went', async () => {
    const sentDry = order({ status: 'SUBMITTED', submittedAt: '2026-10-01T14:12:00+05:30' })
    stubApi({
      ...day({ orders: [sentDry, chilled()] }),
      'GET /api/v1/orders/0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0f/lines': () =>
        linesOf('0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0f', [line({ name: 'Fresh milk 1 L', sku: 'FR-5010' })]),
    })
    renderScreen(<NewOrderPage />, '/store/orders/new?class=chilled')

    const dryCard = await screen.findByRole('button', { name: /Dry order/ })
    expect(within(dryCard).getByText('Sent')).toBeInTheDocument()
    expect(within(dryCard).getByText('Sent 14:12 · #WF-0231 · 544 kg')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Send chilled order' })).toBeInTheDocument()
    expect(screen.getByText(/The dry order went to the dispatcher at 14:12\./)).toBeInTheDocument()
  })
})

describe('M2 Cutoff passed', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetServerClock()
  })

  it('names the following run on the notice, the delivery box and the button', async () => {
    const rolled = order({ afterCutoff: true, deliveryDate: '2026-10-02' })
    stubApi(day({ orders: [rolled, chilled()] }))
    renderScreen(<NewOrderPage />, '/store/orders/new')

    expect(await screen.findByText('Cutoff passed · following run')).toBeInTheDocument()
    expect(screen.getByText(/This order is clearly marked for the following run, Fri 2 Oct\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send dry order for Fri 2 Oct' })).toBeInTheDocument()
    expect(screen.getByText('Fri 2 Oct · 07:00–09:00')).toBeInTheDocument()
    expect(screen.getByText(/Sends order 1 of 2 for the following run\./)).toBeInTheDocument()
  })
})

describe('M1a Add item', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetServerClock()
  })

  it('adds each picked item with the version the last response returned', async () => {
    let version = 1
    const { calls } = stubApi({
      ...day(),
      'GET /api/v1/items': () =>
        page([item(), item({ id: 'i-oil', sku: 'FR-2215', name: 'Sunflower oil 1 L', category: 'Oils', packLabel: 'Case ×12', unitWeightKg: 11 })]),
      [`POST /api/v1/orders/${DRY_ID}/lines`]: () => envelope(order({ version: ++version })),
    })
    renderScreen(<NewOrderPage />, '/store/orders/new')

    await userEvent.click(await screen.findByRole('button', { name: 'Add item' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Add items to dry order')).toBeInTheDocument()
    expect(within(dialog).getByText('Waypoint Fresh range · ambient items only')).toBeInTheDocument()

    const rows = within(dialog).getAllByRole('button', { name: 'Add' })
    await userEvent.click(rows[0] as HTMLElement)
    await userEvent.click(within(dialog).getAllByRole('button', { name: 'Add' })[0] as HTMLElement)
    expect(within(dialog).getByText(/2 selected · 2 cases · 21 kg\./)).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Add 2 items' }))

    await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.path.endsWith('/lines'))).toHaveLength(2))
    const adds = calls.filter((c) => c.method === 'POST' && c.path.endsWith('/lines'))
    expect(adds[0]?.headers['if-match']).toBe('W/"1"')
    expect(adds[1]?.headers['if-match']).toBe('W/"2"')
    expect(adds[0]?.body).toEqual({ itemId: 'i-sugar', qty: 1 })
  })

  it('searches the range by name and shows an empty state when nothing matches', async () => {
    stubApi(day())
    renderScreen(<NewOrderPage />, '/store/orders/new')

    await userEvent.click(await screen.findByRole('button', { name: 'Add item' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByRole('searchbox', { name: 'Search by name or SKU' }), 'lentils')

    expect(await within(dialog).findByText('No items match “lentils”')).toBeInTheDocument()
  })
  describe('ordering ahead', () => {
    const CREATE = { create: { href: '/api/v1/orders', method: 'POST', title: 'New order', requires: ['Idempotency-Key'] } }
    const ME = { id: 'u-1', name: 'Nimesha Periyapperuma', role: 'store_manager', depotId: null, outletId: 'OUT014', status: 'ACTIVE' }
    const fresh = {
      'GET /api/v1/me': () => envelope(ME),
      'GET /api/v1/outlets/OUT014': () => envelope({ id: 'OUT014', name: 'Fresh Kadawatha', brand: 'FRESH', styleDeliveryDow: null }),
      'GET /api/v1/order-templates': () => page([]),
    }

    it('a day with no order offers to start the dry and the chilled one', async () => {
      stubApi({ ...fresh, 'GET /api/v1/orders': () => page([], CREATE) })
      renderScreen(<NewOrderPage />, '/store/orders/new?date=2026-10-08')

      expect(await screen.findByText('No order for Thu 8 Oct yet')).toBeInTheDocument()
      expect(screen.getByLabelText('Delivery day')).toHaveValue('2026-10-08')
      expect(await screen.findByRole('button', { name: 'Start dry order' })).toBeInTheDocument()
      expect(await screen.findByRole('button', { name: 'Start chilled order' })).toBeInTheDocument()
    })

    it('AC-ORD-09 Start posts a draft for the picked day and class, then opens it', async () => {
      const made: unknown[] = []
      const draft = order({ id: 'ord-new', orderNo: 'WF-0300', requestedDate: '2026-10-08', deliveryDate: '2026-10-08' })
      const { calls } = stubApi({
        ...fresh,
        'GET /api/v1/orders': () => page(made, CREATE),
        'POST /api/v1/orders': () => {
          made.push(draft)
          return envelope(draft)
        },
        'GET /api/v1/orders/ord-new/lines': () => linesOf('ord-new', []),
      })
      renderScreen(<NewOrderPage />, '/store/orders/new?date=2026-10-08')

      await userEvent.click(await screen.findByRole('button', { name: 'Start dry order' }))

      expect(await screen.findByRole('button', { name: /Dry order/, pressed: true })).toBeInTheDocument()
      const post = calls.find((c) => c.method === 'POST')
      expect(post?.body).toEqual({ tempClass: 'AMBIENT', requestedDate: '2026-10-08' })
      expect(post?.headers['idempotency-key']).toMatch(/[0-9a-f-]{36}/)
      // The dry order exists now, so only the chilled one is left to start.
      expect(screen.queryByRole('button', { name: 'Start dry order' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Start chilled order' })).toBeInTheDocument()
    })

    it('picking another day shows that day’s orders', async () => {
      const later = order({ id: 'ord-later', orderNo: 'WF-0310', requestedDate: '2026-10-09', deliveryDate: '2026-10-09' })
      stubApi({
        ...day({ orders: [order(), later] }),
        'GET /api/v1/orders/ord-later/lines': () => linesOf('ord-later', []),
      })
      renderScreen(<NewOrderPage />, '/store/orders/new?date=2026-10-09')

      expect(await screen.findByText('Orders · Fri 9 Oct')).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /Dry order/ })).toHaveLength(1)
    })

    it('a Style outlet starts only a dry order and is told its delivery weekday', async () => {
      stubApi({
        ...fresh,
        'GET /api/v1/outlets/OUT014': () => envelope({ id: 'OUT014', name: 'Style Ja-Ela', brand: 'STYLE', styleDeliveryDow: 4 }),
        'GET /api/v1/orders': () => page([], CREATE),
      })
      renderScreen(<NewOrderPage />, '/store/orders/new?date=2026-10-09')

      expect(await screen.findByRole('button', { name: 'Start dry order' })).toBeInTheDocument()
      expect(await screen.findByText('This outlet takes deliveries on Fridays.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Start chilled order' })).not.toBeInTheDocument()
    })
  })
})
