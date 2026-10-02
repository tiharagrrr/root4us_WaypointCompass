import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, renderScreen, stubApi } from '@/test/api-stub'
import { AlertsColumn } from '../alerts-column'
import { NeedsAttentionCard } from '../needs-attention-card'
import { aLateRisk, anAlert, TRIP_ID } from './fixtures'

const listAlerts = (items: unknown[]) => ({ 'GET /api/v1/alerts': () => page(items) })

/** The alert opened in full: the card is an <article>, one per column. */
const openedAlert = () => screen.findByRole('article')

describe('19 Tracking · the alerts column', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('opens the worst alert with only the fixes the server offered', async () => {
    stubApi(listAlerts([anAlert(), aLateRisk()]))
    renderScreen(<AlertsColumn depotId="PLG" />, '/dispatch/tracking')

    const card = await openedAlert()
    expect(within(card).getByRole('heading')).toHaveTextContent('Loader shortfall')

    // The fix the server sent, and nothing it did not: there is no Reassign
    // button, because this alert carried no reassign link (AC-ALR-07).
    expect(within(card).getByRole('button', { name: 'Decide the flag' })).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Reassign the trip' })).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: "I'm on it" })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Resolve' })).toBeInTheDocument()
  })

  it('offers nothing on a resolved alert and shows that it closed itself', async () => {
    const resolved = anAlert({
      status: 'RESOLVED',
      resolvedAt: '2026-10-02T04:55:00+05:30',
      resolvedById: null,
      _links: { self: { href: '/api/v1/alerts/x' } },
    })
    stubApi(listAlerts([resolved]))
    renderScreen(<AlertsColumn depotId="PLG" />, '/dispatch/tracking')

    const card = await openedAlert()
    expect(within(card).queryByRole('button')).not.toBeInTheDocument()
    expect(card).toHaveTextContent('Resolved')
    expect(screen.getByText('0 open')).toBeInTheDocument()
  })

  it('names the severity in words, not only in the dot colour', async () => {
    stubApi(listAlerts([anAlert(), aLateRisk()]))
    renderScreen(<AlertsColumn depotId="PLG" />, '/dispatch/tracking')

    expect(await openedAlert()).toHaveTextContent('Critical')
    expect(screen.getByRole('listitem')).toHaveTextContent('Warning')
  })

  it('asks for the depot and the trip, so 19a sees only that trip', async () => {
    const { calls } = stubApi(listAlerts([aLateRisk()]))
    renderScreen(<AlertsColumn depotId="PLG" tripId={TRIP_ID} />, `/dispatch/trips/${TRIP_ID}`)
    await openedAlert()

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/v1/alerts' })
  })

  it('points a fix at the screen that performs it', async () => {
    stubApi(listAlerts([aLateRisk()]))
    renderScreen(<AlertsColumn depotId="PLG" />, '/dispatch/tracking')

    const card = await openedAlert()
    expect(within(card).getByRole('link', { name: 'Re-sequence the run' })).toHaveAttribute('href', `/dispatch/trips/${TRIP_ID}`)
  })

  it('resolving by hand needs a note before the button works', async () => {
    const { calls } = stubApi({
      ...listAlerts([anAlert()]),
      'POST /api/v1/alerts/0192a3f4-0000-7000-8000-000000000000/resolve': () => page([]),
    })
    renderScreen(<AlertsColumn depotId="PLG" />, '/dispatch/tracking')

    const card = await openedAlert()
    await userEvent.click(within(card).getByRole('button', { name: 'Resolve' }))

    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Resolve' })
    expect(confirm).toBeDisabled()

    await userEvent.type(within(dialog).getByRole('textbox'), 'Driver reached by phone')
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)

    const sent = calls.find((call) => call.method === 'POST')
    expect(sent?.body).toEqual({ note: 'Driver reached by phone' })
  })
})

describe('01 Dashboard · Needs Attention', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists the open alerts and links to where they get fixed', async () => {
    stubApi(listAlerts([anAlert(), aLateRisk()]))
    renderScreen(<NeedsAttentionCard depotId="PLG" />, '/dispatch')

    // The heading is there before the list is, so wait on the rows themselves.
    expect(await screen.findAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('heading', { name: 'Needs Attention' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open tracking to fix these' })).toHaveAttribute('href', '/dispatch/tracking')
  })

  it('says so plainly when the depot is calm', async () => {
    stubApi(listAlerts([]))
    renderScreen(<NeedsAttentionCard depotId="PLG" />, '/dispatch')

    expect(await screen.findByText('Nothing needs you')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open tracking to fix these' })).not.toBeInTheDocument()
  })

  it('shows the problem and a retry when the list fails', async () => {
    stubApi({
      'GET /api/v1/alerts': () =>
        new Response(JSON.stringify({ code: 'FORBIDDEN', status: 403, title: 'Not allowed', detail: 'You need alert:read.' }), {
          status: 403,
          headers: { 'content-type': 'application/problem+json' },
        }),
    })
    renderScreen(<NeedsAttentionCard depotId="PLG" />, '/dispatch')

    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent('Not allowed')
    expect(within(error).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
