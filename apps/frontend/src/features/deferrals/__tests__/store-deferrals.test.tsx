import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, page, renderScreen, stubApi } from '@/test/api-stub'
import { order } from '@/features/ordering/__tests__/fixtures'
import { OrdersPage } from '@/features/ordering/orders-page'
import { DeferralsPage } from '../deferrals-page'
import { aDeferral, answered, DEFERRAL_ID, DEFERRED_ORDER_ID } from './fixtures'

const ME = { id: 'u-nimesha', name: 'Nimesha Periyapperuma', email: 'nimesha.p@waypoint.lk', role: 'store_manager', depotId: null, outletId: 'OUT014', status: 'ACTIVE' }

const deferredOrder = order({
  id: DEFERRED_ORDER_ID,
  orderNo: 'WF-0219',
  status: 'DEFERRED',
  tempClass: 'CHILLED',
  deliveryDate: '2026-10-02',
  _links: { self: { href: `/api/v1/orders/${DEFERRED_ORDER_ID}` } },
})
const planned = order({ id: 'o-planned', orderNo: 'WF-0224', status: 'PLANNED', _links: { self: { href: '/api/v1/orders/o-planned' } } })

function store(routes: Record<string, (url: URL, init?: RequestInit) => unknown> = {}) {
  return stubApi({
    'GET /api/v1/me': () => envelope(ME),
    'GET /api/v1/orders': () => page([planned, deferredOrder]),
    [`GET /api/v1/orders/${DEFERRED_ORDER_ID}`]: () => envelope(deferredOrder),
    'GET /api/v1/deferrals': () => page([aDeferral()]),
    [`GET /api/v1/deferrals/${DEFERRAL_ID}`]: () => envelope(aDeferral()),
    'GET /api/v1/outlets/OUT014/receiving-roster': () =>
      envelope({ outletId: 'OUT014', date: '2026-10-01', entries: [{ id: 'r1', staffName: 'Kasun', fromMin: 420, from: '07:00', toMin: 540, to: '09:00' }], _links: { self: { href: '/x' } } }),
    ...routes,
  })
}

const at = (path: string) =>
  renderScreen(
    <Routes>
      <Route path="/store/orders" element={<OrdersPage />} />
      <Route path="/store/deferrals" element={<DeferralsPage />} />
      <Route path="/store/deferrals/:id" element={<DeferralsPage />} />
    </Routes>,
    path,
  )

describe('M3, M4 and M7 store orders and deferrals', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('M3 shows each order’s progress and a deferred order with its new date', async () => {
    const user = userEvent.setup()
    store()
    at('/store/orders')

    const plannedCard = await screen.findByRole('article', { name: 'WF-0224' })
    expect(within(plannedCard).getByText('Planned')).toHaveAttribute('aria-current', 'step')
    const deferredCard = screen.getByRole('article', { name: 'WF-0219' })
    expect(within(deferredCard).getByText('Moved to Fri 2 Oct · No reefer capacity')).toBeInTheDocument()

    await user.click(within(deferredCard).getByRole('button', { name: 'View notice' }))
    const notice = await screen.findByRole('dialog', { name: 'Deferral notice' })
    expect(within(notice).getByText('No refrigerated vehicle had room for this run.')).toBeInTheDocument()
    expect(within(notice).getByText('REF-02 is in the workshop until Wednesday.')).toBeInTheDocument()
  })

  it('AC-EXE-22 M3 shows the order’s ETA once it is on a trip, and a dash before that', async () => {
    store({
      'GET /api/v1/orders/o-planned/eta': () =>
        envelope({
          orderId: 'o-planned',
          orderNo: 'WF-0224',
          stopId: 's-1',
          tripStatus: 'IN_PROGRESS',
          stopStatus: 'PENDING',
          plannedArrivalAt: '2026-10-02T05:40:00+05:30',
          etaAt: '2026-10-02T05:54:00+05:30',
          spareMin: 6,
          standing: 'NEXT',
          completedAt: null,
          _links: { self: { href: '/api/v1/orders/o-planned/eta' } },
        }),
    })
    at('/store/orders')

    const plannedCard = await screen.findByRole('article', { name: 'WF-0224' })
    expect(await within(plannedCard).findByText('05:54')).toBeInTheDocument()
  })

  it('AC-PLN-27 the store requests priority with a note, once', async () => {
    const user = userEvent.setup()
    const { calls } = store({
      [`POST /api/v1/deferrals/${DEFERRAL_ID}/response`]: () =>
        envelope(answered({ storeResponse: 'PRIORITY_REQUESTED', storeNote: 'We run out of milk by noon' })),
    })
    at(`/store/deferrals/${DEFERRAL_ID}`)

    const notice = await screen.findByRole('dialog', { name: 'Deferral notice' })
    await user.click(await within(notice).findByRole('button', { name: 'Request priority with a note' }))
    const send = within(notice).getByRole('button', { name: 'Ask for priority' })
    expect(send).toBeDisabled()
    await user.type(within(notice).getByRole('textbox', { name: 'Why it needs priority' }), 'We run out of milk by noon')
    await user.click(send)

    const sent = calls.find((c) => c.method === 'POST' && c.path.endsWith('/response'))
    expect(sent?.body).toEqual({ response: 'PRIORITY_REQUESTED', note: 'We run out of milk by noon' })
    expect(sent?.headers['idempotency-key']).toBeTruthy()
    expect(await within(notice).findByText('You asked for priority')).toBeInTheDocument()
    expect(within(notice).queryByRole('button', { name: /Acknowledge/ })).not.toBeInTheDocument()
  })

  it('M4 acknowledging sends ACKNOWLEDGED', async () => {
    const user = userEvent.setup()
    const { calls } = store({ [`POST /api/v1/deferrals/${DEFERRAL_ID}/response`]: () => envelope(answered()) })
    at(`/store/deferrals/${DEFERRAL_ID}`)

    const notice = await screen.findByRole('dialog', { name: 'Deferral notice' })
    await user.click(await within(notice).findByRole('button', { name: 'Acknowledge · adjust staff' }))

    expect(calls.find((c) => c.path.endsWith('/response'))?.body).toEqual({ response: 'ACKNOWLEDGED' })
  })

  it('M4 offers no answer once the deferral carries no respond link', async () => {
    store({ [`GET /api/v1/deferrals/${DEFERRAL_ID}`]: () => envelope(answered()) })
    at(`/store/deferrals/${DEFERRAL_ID}`)

    const notice = await screen.findByRole('dialog', { name: 'Deferral notice' })
    expect(await within(notice).findByText('You acknowledged it')).toBeInTheDocument()
    expect(within(notice).queryByRole('button', { name: /Acknowledge/ })).not.toBeInTheDocument()
    expect(within(notice).queryByRole('button', { name: /Request priority/ })).not.toBeInTheDocument()
  })

  it('M7 lists deferrals with reasons and what still waits on the store', async () => {
    store({
      'GET /api/v1/deferrals': () =>
        page([
          aDeferral({ repeatSkip: true }),
          answered({ id: 'd-2', orderNo: 'WF-0131', fromDate: '2026-09-24', toDate: '2026-09-25', storeResponse: 'PRIORITY_REQUESTED' }),
        ]),
    })
    at('/store/deferrals')

    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('WF-0219')
    expect(rows[1]).toHaveTextContent('Thu 1 Oct → Fri 2 Oct')
    expect(rows[1]).toHaveTextContent('Repeat skip')
    expect(within(rows[1]!).getByRole('button', { name: 'View notice' })).toBeInTheDocument()
    expect(rows[2]).toHaveTextContent('Priority asked')
    expect(screen.getByRole('region', { name: 'Waiting on you' })).toHaveTextContent('1')
  })
})
