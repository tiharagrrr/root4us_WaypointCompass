import type { NotificationPreferenceDto } from '@compass/api-client'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, renderScreen, stubApi } from '@/test/api-stub'
import { NotificationPreferences } from '../notification-preferences'

const item = (over: Partial<NotificationPreferenceDto> = {}): NotificationPreferenceDto => ({
  eventType: 'trip.released',
  label: 'Trip released',
  example: 'REF-07 trip 1 released. 6 stops, first Fresh Kadawatha at 04:10. Open the app to start.',
  defaults: ['IN_APP', 'SMS', 'PUSH'],
  available: ['IN_APP', 'SMS'],
  channels: ['IN_APP', 'SMS'],
  custom: false,
  _links: {
    self: { href: '/api/v1/me/notification-preferences/trip.released' },
    update: { href: '/api/v1/me/notification-preferences/trip.released', method: 'PUT' },
  },
  ...over,
})

const sheet = (items: NotificationPreferenceDto[], emailSuppressed = false) =>
  envelope({
    items,
    emailSuppressed,
    _links: {
      self: { href: '/api/v1/me/notification-preferences' },
      ...(emailSuppressed && { resumeEmail: { href: '/api/v1/me/notification-preferences/resume-email', method: 'POST', title: 'Turn email back on' } }),
    },
  })

describe('D12 and 02 notification settings', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('AC-NTF-03 switching a channel off saves the rest, and in-app stays on', async () => {
    const user = userEvent.setup()
    const { calls } = stubApi({
      'GET /api/v1/me/notification-preferences': () => sheet([item()]),
      'PUT /api/v1/me/notification-preferences/trip.released': () => envelope(item({ channels: ['IN_APP'], custom: true })),
    })
    renderScreen(<NotificationPreferences touch />)

    const card = await screen.findByRole('listitem', { name: 'Trip released' })
    expect(within(card).getByRole('switch', { name: /In the app/ })).toBeDisabled()
    // Push isn't set up on this phone, so it says why instead of offering a switch that does nothing.
    expect(within(card).getByText('Push is not set up on this device')).toBeInTheDocument()
    expect(within(card).getByRole('switch', { name: /Push/ })).toBeDisabled()

    await user.click(within(card).getByRole('switch', { name: /SMS/ }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
        path: '/api/v1/me/notification-preferences/trip.released',
        body: { channels: [] },
      }),
    )
  })

  it('AC-NTF-08 after a bounce, says email is off and offers to turn it back on', async () => {
    const user = userEvent.setup()
    const { calls } = stubApi({
      'GET /api/v1/me/notification-preferences': () =>
        sheet([item({ eventType: 'deferral.confirmed', label: 'Order deferred', defaults: ['IN_APP', 'EMAIL', 'PUSH'], available: ['IN_APP', 'EMAIL', 'PUSH'], channels: ['IN_APP', 'PUSH'] })], true),
      'POST /api/v1/me/notification-preferences/resume-email': () => sheet([], false),
    })
    renderScreen(<NotificationPreferences />)

    expect(await screen.findByRole('status')).toHaveTextContent('Email is off')
    await user.click(screen.getByRole('button', { name: 'Turn email back on' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/resume-email'))).toBe(true))
  })
})
