import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, page, renderScreen, stubApi } from '@/test/api-stub'
import { order } from '@/features/ordering/__tests__/fixtures'
import { DispatchDeferralsPage } from '../dispatch-deferrals-page'
import { aDeferral, answered, DEFERRAL_ID, DEFERRED_ORDER_ID } from './fixtures'

const self = (id: string) => `/api/v1/deferrals/${id}`

/** WF-0131 at Kadawatha: a repeat skip the store asked priority for, logged by Tihara. */
const priority = answered({
  id: DEFERRAL_ID,
  orderNo: 'WF-0131',
  storeResponse: 'PRIORITY_REQUESTED',
  storeNote: 'Dairy shelf has been empty since Thursday.',
  storeRespondedByName: 'Nimesha Periyapperuma',
  storeRespondedAt: '2026-09-24T17:10:00+05:30',
  decidedByName: 'Tihara Egodage',
  repeatSkip: true,
  skips30d: 3,
  recentSkips: 3,
  recentRuns: 5,
  _links: {
    self: { href: self(DEFERRAL_ID) },
    order: { href: `/api/v1/orders/${DEFERRED_ORDER_ID}` },
    reply: { href: `${self(DEFERRAL_ID)}/reply`, method: 'POST', title: 'Reply to store', requires: ['Idempotency-Key'] },
  },
})
const quiet = aDeferral({
  id: 'd-2',
  orderNo: 'WT-0029',
  outletName: 'Tech Negombo',
  outletBrand: 'TECH',
  reasonLabel: 'Access',
  skips30d: 1,
  decidedByName: null,
  _links: { self: { href: self('d-2') } },
})
const history = [
  aDeferral({ id: 'h1', fromDate: '2026-09-24', reasonLabel: 'No reefer capacity' }),
  aDeferral({ id: 'h2', fromDate: '2026-09-21', reasonLabel: 'Over capacity' }),
]
const pinnable = order({
  id: DEFERRED_ORDER_ID,
  orderNo: 'WF-0131',
  status: 'DEFERRED',
  version: 4,
  _links: {
    self: { href: `/api/v1/orders/${DEFERRED_ORDER_ID}` },
    priority: { href: `/api/v1/orders/${DEFERRED_ORDER_ID}/priority`, method: 'PATCH', title: 'Mark urgent', requires: ['If-Match'] },
  },
})

/** Counts come from one-row pages; the history panel asks by outlet; the table gets the rows. */
function dispatcher(routes: Record<string, (url: URL, init?: RequestInit) => unknown> = {}) {
  return stubApi({
    'GET /api/v1/deferrals': (url) => {
      if (url.searchParams.get('filter[outletId]')) return page(history)
      if (url.searchParams.get('limit') === '1') {
        const total = url.searchParams.get('filter[storeResponse]') === 'PRIORITY_REQUESTED' ? 2 : url.searchParams.get('filter[repeatSkip]') ? 4 : 25
        return { ...page([priority]), meta: { ...page([]).meta, page: { limit: 1, offset: 0, total } } }
      }
      return page([priority, quiet])
    },
    'GET /api/v1/orders': () => ({ ...page([]), meta: { ...page([]).meta, page: { limit: 1, offset: 0, total: 1486 } } }),
    [`GET /api/v1/orders/${DEFERRED_ORDER_ID}`]: () => envelope(pinnable),
    'GET /api/v1/deferral-reasons': () => page([{ code: 'OVER_CAPACITY', label: 'Over capacity', active: true }]),
    ...routes,
  })
}

describe('23 deferrals for dispatchers', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('AC-PLN-36 lists each deferral with its skips, the store’s answer and who logged it', async () => {
    dispatcher()
    renderScreen(<DispatchDeferralsPage />)

    const row = await screen.findByRole('row', { name: /WF-0131/ })
    expect(within(row).getByText('Kadawatha')).toBeInTheDocument()
    expect(within(row).getByText('×3')).toBeInTheDocument()
    expect(within(row).getByText('Priority asked')).toBeInTheDocument()
    expect(within(row).getByText('T. Egodage')).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /WT-0029/ })).getByText('Engine')).toBeInTheDocument()

    const deferred = screen.getByRole('region', { name: 'Deferred' })
    expect(await within(deferred).findByText('25')).toBeInTheDocument()
    expect(within(deferred).getByText('of 1,486 orders · 1.7%')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Repeat skips' })).getByText('4')).toBeInTheDocument()

    // The first row opens in the panel: the store's note, who wrote it, and the outlet's history.
    const panel = screen.getByRole('complementary', { name: 'Deferral WF-0131' })
    expect(within(panel).getByText('Dairy shelf has been empty since Thursday.')).toBeInTheDocument()
    expect(within(panel).getByText('Nimesha Periyapperuma · Thu 24 Sep, 17:10')).toBeInTheDocument()
    expect(within(panel).getByText('3 of last 5 runs')).toBeInTheDocument()
    expect(await within(panel).findByText('Thu 24 Sep')).toBeInTheDocument()
  })

  it('narrows the log by tab and outlet search', async () => {
    const user = userEvent.setup()
    const seen: URL[] = []
    dispatcher({
      'GET /api/v1/deferrals': (url) => {
        seen.push(url)
        return page([priority])
      },
    })
    renderScreen(<DispatchDeferralsPage />)
    await screen.findByRole('row', { name: /WF-0131/ })

    await user.click(screen.getByRole('radio', { name: /Priority/ }))
    await waitFor(() =>
      expect(seen.some((u) => u.searchParams.get('filter[storeResponse]') === 'PRIORITY_REQUESTED' && u.searchParams.get('limit') === '10')).toBe(true),
    )
    await user.type(screen.getByRole('textbox', { name: 'Search outlet' }), 'kada')
    await waitFor(() => expect(seen.some((u) => u.searchParams.get('q') === 'kada')).toBe(true))
    // Always within the period, at the depot the header switch shows.
    const log = seen.filter((u) => !u.searchParams.has('filter[outletId]'))
    expect(log.every((u) => u.searchParams.get('filter[fromDate][gte]') && u.searchParams.get('filter[depotId]') === 'PLG')).toBe(true)
  })

  it('AC-PLN-35 the dispatcher replies to the store once', async () => {
    const user = userEvent.setup()
    const { calls } = dispatcher({
      [`POST /api/v1/deferrals/${DEFERRAL_ID}/reply`]: () =>
        envelope({ ...priority, dispatcherReply: 'Pinned to Friday’s first run', _links: { self: { href: self(DEFERRAL_ID) } } }),
    })
    renderScreen(<DispatchDeferralsPage />)

    const panel = await screen.findByRole('complementary', { name: 'Deferral WF-0131' })
    await user.click(within(panel).getByRole('button', { name: 'Reply to store' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reply to store' })
    const send = within(dialog).getByRole('button', { name: 'Send reply' })
    expect(send).toBeDisabled()
    await user.type(within(dialog).getByRole('textbox', { name: 'Your reply' }), 'Pinned to Friday’s first run')
    await user.click(send)

    const sent = calls.find((c) => c.method === 'POST' && c.path.endsWith('/reply'))
    expect(sent?.body).toEqual({ text: 'Pinned to Friday’s first run' })
    expect(sent?.headers['idempotency-key']).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Reply to store' })).not.toBeInTheDocument())
  })

  it('pins the order to the next run with its version, and offers no reply without the link', async () => {
    const user = userEvent.setup()
    const { calls } = dispatcher({
      'GET /api/v1/deferrals': (url) => (url.searchParams.get('filter[outletId]') ? page(history) : page([{ ...priority, _links: { self: { href: self(DEFERRAL_ID) } } }])),
      [`PATCH /api/v1/orders/${DEFERRED_ORDER_ID}/priority`]: () => envelope({ ...pinnable, urgent: true }),
    })
    renderScreen(<DispatchDeferralsPage />)

    const panel = await screen.findByRole('complementary', { name: 'Deferral WF-0131' })
    expect(within(panel).queryByRole('button', { name: 'Reply to store' })).not.toBeInTheDocument()
    await user.click(await within(panel).findByRole('button', { name: 'Pin to next run' }))

    const pinned = calls.find((c) => c.method === 'PATCH')
    expect(pinned?.body).toEqual({ urgent: true })
    expect(pinned?.headers['if-match']).toBe('W/"4"')
  })

  it('says so when the period has no deferrals', async () => {
    dispatcher({ 'GET /api/v1/deferrals': () => page([]) })
    renderScreen(<DispatchDeferralsPage />)
    expect(await screen.findByText('No deferrals in this period')).toBeInTheDocument()
  })
})
