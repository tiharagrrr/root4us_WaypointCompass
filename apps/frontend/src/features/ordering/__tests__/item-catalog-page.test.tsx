import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, page, renderScreen, stubApi } from '@/test/api-stub'
import { ItemCatalogPage } from '../item-catalog-page'
import { DRY_ID, item, order } from './fixtures'

const ME = { id: 'u-1', name: 'Nimesha Periyapperuma', role: 'store_manager', depotId: null, outletId: 'OUT014', status: 'ACTIVE' }

const SUGAR = item()
const RICE = item({ id: 'i-rice', sku: 'FR-1102', name: 'Basmati rice 5 kg', packLabel: 'Bag ×4', unitWeightKg: 20, unitVolumeM3: 0.03 })
const MILK = item({ id: 'i-milk', sku: 'FR-5010', name: 'Fresh milk 1 L', category: 'Dairy', tempClass: 'CHILLED', packLabel: 'Crate ×12', unitWeightKg: 13, unitVolumeM3: 0.03 })

const DRY = order({
  version: 3,
  _links: {
    self: { href: `/api/v1/orders/${DRY_ID}` },
    addLine: { href: `/api/v1/orders/${DRY_ID}/lines`, method: 'POST', title: 'Add item', requires: ['If-Match'] },
  },
})

const catalog = (routes: Record<string, (url: URL) => unknown> = {}) =>
  stubApi({
    'GET /api/v1/me': () => envelope(ME),
    'GET /api/v1/outlets/OUT014': () => envelope({ id: 'OUT014', name: 'Fresh Kadawatha', brand: 'FRESH', styleDeliveryDow: null }),
    'GET /api/v1/items': () => page([RICE, MILK, SUGAR]),
    'GET /api/v1/orders': () => page([DRY]),
    ...routes,
  })

describe('M9 Item catalog', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists the outlet’s range with pack, weight, volume and storage, and counts it in the banner', async () => {
    catalog()
    renderScreen(<ItemCatalogPage />, '/store/catalog')

    const rice = (await screen.findByText('Basmati rice 5 kg')).closest('tr') as HTMLElement
    expect(within(rice).getByText('FR-1102')).toBeInTheDocument()
    expect(within(rice).getByText('Bag ×4')).toBeInTheDocument()
    expect(within(rice).getByText('20 kg · 0.03 m³')).toBeInTheDocument()
    expect(within(rice).getByText('DRY')).toBeInTheDocument()
    expect(within(screen.getByText('Fresh milk 1 L').closest('tr') as HTMLElement).getByText('CHILLED')).toBeInTheDocument()
    expect(
      await screen.findByText(
        'Fresh Kadawatha orders from the Waypoint Fresh range: 3 items, 2 dry and 1 chilled. Outlets of the other brands only see their own range.',
      ),
    ).toBeInTheDocument()
  })

  it('searches by name or SKU', async () => {
    const user = userEvent.setup()
    catalog()
    renderScreen(<ItemCatalogPage />, '/store/catalog')
    await screen.findByText('Basmati rice 5 kg')

    await user.type(screen.getByLabelText('Search items or SKU'), 'fr-5010')

    await waitFor(() => expect(screen.queryByText('Basmati rice 5 kg')).not.toBeInTheDocument())
    expect(screen.getByText('Fresh milk 1 L')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Search items or SKU'))
    await user.type(screen.getByLabelText('Search items or SKU'), 'nothing like this')
    expect(await screen.findByText('No item matches')).toBeInTheDocument()
  })

  it('Add puts one pack on the open order of the item’s class, and shows only where one is open', async () => {
    const user = userEvent.setup()
    const { calls } = catalog({
      [`POST /api/v1/orders/${DRY_ID}/lines`]: () => envelope({ orderId: DRY_ID, version: 4, lines: [], _links: {} }),
    })
    renderScreen(<ItemCatalogPage />, '/store/catalog')

    // No chilled order is open, so the chilled item has no Add.
    await screen.findByRole('button', { name: 'Add Sugar 1 kg' })
    expect(screen.queryByRole('button', { name: 'Add Fresh milk 1 L' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add Sugar 1 kg' }))

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const post = calls.find((c) => c.method === 'POST')
    expect(post?.path).toBe(`/api/v1/orders/${DRY_ID}/lines`)
    expect(post?.body).toEqual({ itemId: 'i-sugar', qty: 1 })
    expect(post?.headers['if-match']).toBe('W/"3"')
  })
})
