import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, page, renderScreen, stubApi } from '@/test/api-stub'
import { order } from '@/features/ordering/__tests__/fixtures'
import { DispatchIssuesPage } from '../dispatch-issues-page'
import { ReceiptsPage } from '../receipts-page'
import { confirmed, ISSUE_ID, issue, ORDER_ID, receipt } from './fixtures'

const delivered = order({ id: ORDER_ID, orderNo: 'WF-0218', status: 'DELIVERED', _links: { self: { href: `/api/v1/orders/${ORDER_ID}` } } })
const received = order({ id: 'o-received', orderNo: 'WF-0200', status: 'RECEIVED', _links: { self: { href: '/api/v1/orders/o-received' } } })

type Routes = Record<string, (url: URL, init?: RequestInit) => unknown>

function api(routes: Routes = {}) {
  return stubApi({
    'GET /api/v1/orders': (url) => page(url.searchParams.get('filter[status]') === 'DELIVERED,PARTIAL' ? [delivered] : [received]),
    'GET /api/v1/issues': () => page([]),
    'GET /api/v1/attachments/sig-1': () => envelope({ id: 'sig-1', kind: 'SIGNATURE', url: 'https://files.test/sig.png', expiresAt: '2026-10-02T09:15:00+05:30' }),
    'GET /api/v1/attachments/photo-1': () => envelope({ id: 'photo-1', kind: 'POD_PHOTO', url: 'https://files.test/photo.png', expiresAt: '2026-10-02T09:15:00+05:30' }),
    ...routes,
  })
}

const at = (path: string) =>
  renderScreen(
    <Routes>
      <Route path="/store/receipts" element={<ReceiptsPage />} />
      <Route path="/store/orders/:id/receipt" element={<ReceiptsPage />} />
      <Route path="/store/orders/:id/issue" element={<ReceiptsPage />} />
      <Route path="/store/issues/:id" element={<ReceiptsPage />} />
      <Route path="/dispatch/issues" element={<DispatchIssuesPage />} />
      <Route path="/dispatch/issues/:id" element={<DispatchIssuesPage />} />
    </Routes>,
    path,
  )

describe('M5, M6 and the issue thread', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('the Receipts list leads a delivered order to M5', async () => {
    const user = userEvent.setup()
    api({ [`GET /api/v1/orders/${ORDER_ID}/receipt`]: () => envelope(receipt()) })
    at('/store/receipts')

    const row = (await screen.findByText('#WF-0218')).closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Confirm' }))

    const dialog = await screen.findByRole('dialog', { name: 'Confirm receipt' })
    expect(within(dialog).getByText('Delivered 07:48 · Order #WF-0218')).toBeInTheDocument()
  })

  it('M5 shows the driver’s proof and confirms only once every line is ticked', async () => {
    const user = userEvent.setup()
    const { calls } = api({
      [`GET /api/v1/orders/${ORDER_ID}/receipt`]: () => envelope(receipt()),
      [`POST /api/v1/orders/${ORDER_ID}/receipt`]: () => envelope(confirmed()),
    })
    at(`/store/orders/${ORDER_ID}/receipt`)

    const dialog = await screen.findByRole('dialog', { name: 'Confirm receipt' })
    expect(await within(dialog).findByText('Chathura (store staff)')).toBeInTheDocument()
    expect(await within(dialog).findByRole('img', { name: 'Signature' })).toHaveAttribute('src', 'https://files.test/sig.png')
    expect(within(dialog).getByText('0 of 3 checked')).toBeInTheDocument()

    const confirm = within(dialog).getByRole('button', { name: 'All received · confirm' })
    expect(confirm).toBeDisabled()
    for (const name of ['Basmati rice 5 kg', 'Coconut oil 1 L']) await user.click(within(dialog).getByRole('checkbox', { name }))
    expect(within(dialog).getByText('2 of 3 checked')).toBeInTheDocument()
    expect(confirm).toBeDisabled()

    await user.click(within(dialog).getByRole('checkbox', { name: 'Wheat flour 1 kg' }))
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const sent = calls.find((c) => c.method === 'POST')
    expect(sent?.body).toEqual({
      lines: [
        { orderLineId: 'l1', qtyReceived: 12, condition: 'ok' },
        { orderLineId: 'l2', qtyReceived: 8, condition: 'ok' },
        { orderLineId: 'l3', qtyReceived: 10, condition: 'ok' },
      ],
    })
    // The order's version rides If-Match, and the press carries its own Idempotency-Key.
    expect(sent?.headers['if-match']).toBe('W/"8"')
    expect(sent?.headers['idempotency-key']).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Confirm receipt' })).not.toBeInTheDocument())
  })

  it('AC-RCP-05 a delivery that has not happened has no confirm button', async () => {
    api({
      [`GET /api/v1/orders/${ORDER_ID}/receipt`]: () =>
        envelope(
          receipt({
            orderStatus: 'IN_TRANSIT',
            stopStatus: 'PENDING',
            proof: { receiverName: null, deliveredAt: null, signature: null, photo: null },
            lines: receipt().lines.map((l) => ({ ...l, qtyDelivered: null })),
            _links: { self: { href: `/api/v1/orders/${ORDER_ID}/receipt` } },
          }),
        ),
    })
    at(`/store/orders/${ORDER_ID}/receipt`)

    const dialog = await screen.findByRole('dialog', { name: 'Confirm receipt' })
    expect(await within(dialog).findByText('Order #WF-0218', { exact: false })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'All received · confirm' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Report an issue' })).not.toBeInTheDocument()
    // The dialog's own X and the footer's Close.
    expect(within(dialog).getAllByRole('button', { name: 'Close' })).toHaveLength(2)
  })

  it('AC-RCP-03 an early confirmation says it is waiting for the driver', async () => {
    api({
      [`GET /api/v1/orders/${ORDER_ID}/receipt`]: () =>
        envelope(confirmed({ awaitingDriverSync: true, orderStatus: 'IN_TRANSIT', proof: { receiverName: null, deliveredAt: null, signature: null, photo: null } })),
    })
    at(`/store/orders/${ORDER_ID}/receipt`)

    const dialog = await screen.findByRole('dialog', { name: 'Confirm receipt' })
    expect(await within(dialog).findByText(/before the driver’s record arrived/)).toBeInTheDocument()
    expect(within(dialog).getByText('Confirmed · 09:10')).toBeInTheDocument()
  })

  it('AC-RCP-02 M6 before confirming confirms the rest and raises the issue in one send', async () => {
    const user = userEvent.setup()
    const { calls } = api({
      [`GET /api/v1/orders/${ORDER_ID}/receipt`]: () => envelope(receipt()),
      [`POST /api/v1/orders/${ORDER_ID}/receipt`]: () => envelope(confirmed({ status: 'CONFIRMED_WITH_ISSUES', issueIds: [ISSUE_ID] })),
    })
    at(`/store/orders/${ORDER_ID}/issue`)

    const dialog = await screen.findByRole('dialog', { name: 'Report issue' })
    await within(dialog).findByText('Order #WF-0218 · delivered 07:48')
    const send = within(dialog).getByRole('button', { name: 'Send to dispatcher' })
    expect(send).toBeDisabled()
    await user.click(within(dialog).getByRole('radio', { name: 'Short' }))
    await user.click(within(dialog).getByRole('button', { name: 'One more Basmati rice 5 kg' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Note' }), 'Two cases missing from the pallet')
    await user.click(send)

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const sent = calls.find((c) => c.method === 'POST')
    expect(sent?.body).toEqual({
      lines: [
        { orderLineId: 'l1', qtyReceived: 10, condition: 'short', qtyAffected: 2, note: 'Two cases missing from the pallet' },
        { orderLineId: 'l2', qtyReceived: 8, condition: 'ok' },
        { orderLineId: 'l3', qtyReceived: 10, condition: 'ok' },
      ],
      note: 'Two cases missing from the pallet',
    })
    expect(sent?.headers['if-match']).toBe('W/"8"')
    expect(sent?.headers['idempotency-key']).toBeTruthy()
  })

  it('AC-RCP-10 M6 after confirming posts an issue against the received order', async () => {
    const user = userEvent.setup()
    const { calls } = api({
      [`GET /api/v1/orders/${ORDER_ID}/receipt`]: () => envelope(confirmed()),
      'POST /api/v1/issues': () => envelope(issue()),
    })
    at(`/store/orders/${ORDER_ID}/issue`)

    const dialog = await screen.findByRole('dialog', { name: 'Report issue' })
    await within(dialog).findByText('Order #WF-0218 · delivered 07:48')
    await user.click(within(dialog).getByRole('radio', { name: 'Damaged' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Note' }), '3 trays damaged')
    await user.click(within(dialog).getByRole('button', { name: 'Send to dispatcher' }))

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const sent = calls.find((c) => c.method === 'POST')
    expect(sent?.path).toBe('/api/v1/issues')
    expect(sent?.body).toEqual({ orderId: ORDER_ID, orderLineId: 'l1', type: 'DAMAGED', qtyAffected: 1, description: '3 trays damaged' })
    expect(sent?.headers['if-match']).toBe('W/"9"')
  })

  it('AC-RCP-12 the thread shows what was said and lets the store add to it', async () => {
    const user = userEvent.setup()
    const comment = {
      id: 'c1',
      issueId: ISSUE_ID,
      authorId: 'u-tihara',
      authorRole: 'dispatcher',
      authorName: 'Tihara Egodage',
      body: 'Credit on the way',
      createdAt: '2026-10-02T10:45:00+05:30',
      _links: { self: { href: '/x' } },
    }
    const { calls } = api({
      [`GET /api/v1/issues/${ISSUE_ID}`]: () => envelope(issue()),
      [`GET /api/v1/issues/${ISSUE_ID}/comments`]: () => page([comment]),
      [`POST /api/v1/issues/${ISSUE_ID}/comments`]: () => envelope({ ...comment, id: 'c2', authorRole: 'store_manager', body: 'Thanks' }),
    })
    at(`/store/issues/${ISSUE_ID}`)

    const dialog = await screen.findByRole('dialog', { name: 'Issue · Short' })
    expect(await within(dialog).findByText('Credit on the way')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Resolve issue' })).not.toBeInTheDocument()
    await user.type(within(dialog).getByRole('textbox', { name: 'Comment' }), 'Thanks')
    await user.click(within(dialog).getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ body: 'Thanks' })
  })

  it('AC-RCP-13 the dispatcher resolves an open issue, and only then', async () => {
    const user = userEvent.setup()
    const resolvable = issue({
      _links: {
        self: { href: `/api/v1/issues/${ISSUE_ID}` },
        comment: { href: `/api/v1/issues/${ISSUE_ID}/comments`, method: 'POST' },
        resolve: { href: `/api/v1/issues/${ISSUE_ID}/resolve`, method: 'POST' },
      },
    })
    const { calls } = api({
      'GET /api/v1/issues': () => page([resolvable]),
      [`GET /api/v1/issues/${ISSUE_ID}`]: () => envelope(resolvable),
      [`GET /api/v1/issues/${ISSUE_ID}/comments`]: () => page([]),
      [`POST /api/v1/issues/${ISSUE_ID}/resolve`]: () => envelope(issue({ status: 'RESOLVED', resolution: 'CREDIT_ISSUED' })),
    })
    at(`/dispatch/issues/${ISSUE_ID}`)

    const dialog = await screen.findByRole('dialog', { name: 'Issue · Short' })
    const resolve = await within(dialog).findByRole('button', { name: 'Resolve issue' })
    expect(resolve).toBeDisabled()
    await user.click(within(dialog).getByRole('radio', { name: 'Credit issued' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Resolution note' }), 'Credit note sent')
    await user.click(resolve)

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/resolve'))).toBe(true))
    expect(calls.find((c) => c.path.endsWith('/resolve'))?.body).toEqual({ resolution: 'CREDIT_ISSUED', note: 'Credit note sent' })
  })

  it('AC-RCP-14 a resolved issue offers reopen only while its link is there', async () => {
    api({
      [`GET /api/v1/issues/${ISSUE_ID}`]: () =>
        envelope(
          issue({
            status: 'RESOLVED',
            resolution: 'CREDIT_ISSUED',
            resolutionNote: 'Credit note sent',
            resolvedAt: '2026-10-02T11:00:00+05:30',
            _links: { self: { href: '/x' }, reopen: { href: `/api/v1/issues/${ISSUE_ID}/reopen`, method: 'POST' } },
          }),
        ),
      [`GET /api/v1/issues/${ISSUE_ID}/comments`]: () => page([]),
    })
    at(`/store/issues/${ISSUE_ID}`)

    const dialog = await screen.findByRole('dialog', { name: 'Issue · Short' })
    expect(await within(dialog).findByRole('button', { name: 'Reopen issue' })).toBeInTheDocument()
    expect(within(dialog).getByText(/Credit issued/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Resolve issue' })).not.toBeInTheDocument()
  })
})
