import type { NotificationDto } from '@compass/api-client'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, renderScreen, stubApi } from '@/test/api-stub'
import { NotificationBell } from '../notification-bell'

const note = (n: number, over: Partial<NotificationDto> = {}): NotificationDto => ({
  id: `n${n}`,
  eventType: 'deferral.confirmed',
  title: `Order WF-017${n} moves to Fri 2 Oct`,
  body: `Order WF-017${n} moves to Fri 2 Oct: no reefer capacity.`,
  link: `/store/deferrals/d${n}`,
  createdAt: '2026-10-01T15:00:00+05:30',
  readAt: null,
  _links: { self: { href: `/api/v1/me/notifications/n${n}` }, read: { href: `/api/v1/me/notifications/n${n}/read`, method: 'POST' } },
  ...over,
})

const feed = (items: NotificationDto[]) => ({
  ...envelope(items, { page: { limit: 50, nextCursor: null, hasMore: false } }),
  _links: { self: { href: '/api/v1/me/notifications' } },
})

const summary = (unread: number) =>
  envelope({
    unread,
    _links: {
      self: { href: '/api/v1/me/notifications/summary' },
      ...(unread && { readAll: { href: '/api/v1/me/notifications/read-all', method: 'POST' } }),
    },
  })

describe('02 Notifications', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('AC-NTF-13 the bell shows my unread count and lists my notifications by day', async () => {
    const user = userEvent.setup()
    stubApi({
      'GET /api/v1/me/notifications/summary': () => summary(2),
      'GET /api/v1/me/notifications': () =>
        feed([
          note(1),
          note(2, { eventType: 'trip.cant_run', title: "DRY-31 can't run", body: "DRY-31 can't run: breakdown.", link: '/dispatch/trips/t1' }),
          note(3, { readAt: '2026-09-30T10:00:00+05:30', createdAt: '2026-09-30T09:00:00+05:30', _links: { self: { href: '/x' } } }),
        ]),
    })
    renderScreen(<NotificationBell />)

    const bell = await screen.findByRole('button', { name: 'Notifications, 2 unread' })
    await user.click(bell)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('2 unread')).toBeInTheDocument()
    expect(await within(dialog).findByRole('listitem', { name: 'Order WF-0171 moves to Fri 2 Oct' })).toBeInTheDocument()
    expect(within(dialog).getByRole('region', { name: 'Today' })).toBeInTheDocument()
    expect(within(dialog).getByRole('region', { name: 'Yesterday' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('radio', { name: /Unread/ }))
    expect(within(dialog).queryByRole('listitem', { name: 'Order WF-0173 moves to Fri 2 Oct' })).not.toBeInTheDocument()
    const urgent = within(dialog).getByRole('listitem', { name: "DRY-31 can't run" })
    expect(within(urgent).getByRole('button', { name: 'Open' })).toBeInTheDocument()
  })

  it('AC-NTF-09 opening a notification marks it read and goes where it points', async () => {
    const user = userEvent.setup()
    const { calls } = stubApi({
      'GET /api/v1/me/notifications/summary': () => summary(1),
      'GET /api/v1/me/notifications': () => feed([note(1)]),
      'POST /api/v1/me/notifications/n1/read': () => envelope(note(1, { readAt: '2026-10-01T15:05:00+05:30' })),
    })
    renderScreen(
      <Routes>
        <Route path="/" element={<NotificationBell />} />
        <Route path="/store/deferrals/:id" element={<p>Deferral notice</p>} />
      </Routes>,
    )

    await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
    const line = await screen.findByRole('listitem', { name: 'Order WF-0171 moves to Fri 2 Oct' })
    await user.click(within(line).getByRole('button', { name: /Order WF-0171 moves to Fri 2 Oct/ }))

    expect(await screen.findByText('Deferral notice')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/v1/me/notifications/n1/read')).toBe(true)
  })

  it('marks all read only while the summary offers it, and says when there is nothing', async () => {
    const user = userEvent.setup()
    stubApi({
      'GET /api/v1/me/notifications/summary': () => summary(0),
      'GET /api/v1/me/notifications': () => feed([]),
    })
    renderScreen(<NotificationBell />)

    await user.click(await screen.findByRole('button', { name: 'Notifications' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('No notifications yet')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Mark all read' })).not.toBeInTheDocument()
  })
})
