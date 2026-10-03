import 'fake-indexeddb/auto'
import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/offline'
import { envelope, renderScreen, stubApi } from '@/test/api-stub'
import { RunsPage } from '../runs-page'
import { aMe, aTripSummary, DEPOT_ID, TRIP_ID } from './fixtures'

const runs = (groups: unknown[]) => ({
  'GET /api/v1/me': () => envelope(aMe()),
  [`GET /api/v1/depots/${DEPOT_ID}/loading/runs`]: () => ({ data: groups }),
})

describe('L2m-a Runs', () => {
  beforeEach(async () => {
    await db.open()
    await db.outbox.clear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('AC-LOD-02 shows the dock’s runs by wave, with progress and open flags', async () => {
    const { calls } = stubApi(
      runs([
        {
          waveId: 'wave-fresh',
          label: 'Fresh wave',
          departFromMin: 330,
          departToMin: 390,
          progress: { lines: 42, checked: 18, outstanding: 24, openFlags: 1 },
          trips: [aTripSummary({ progress: { lines: 42, checked: 18, outstanding: 24, openFlags: 1 } })],
        },
        {
          waveId: null,
          label: 'No wave',
          departFromMin: null,
          departToMin: null,
          progress: { lines: 12, checked: 0, outstanding: 12, openFlags: 0 },
          trips: [aTripSummary({ id: 'trip-dry', vehicleId: 'DRY-22', tempClass: 'AMBIENT', status: 'PLANNED', progress: { lines: 12, checked: 0, outstanding: 12, openFlags: 0 } })],
        },
      ]),
    )
    renderScreen(<RunsPage />, '/dock')

    expect(await screen.findByRole('heading', { name: 'Runs', level: 1 })).toBeInTheDocument()
    expect(await screen.findByText('Fresh wave')).toBeInTheDocument()
    // Trips that belong to no wave keep a group of their own rather than vanishing from the board.
    expect(screen.getByText('No wave')).toBeInTheDocument()

    const first = screen.getAllByRole('listitem')[0]!
    expect(within(first).getByText('REF-07')).toBeInTheDocument()
    expect(within(first).getByText('FLAGGED')).toBeInTheDocument()
    expect(within(first).getByText(/Departs 05:45 · 8 stops · 18 \/ 42 ITEMS/)).toBeInTheDocument()
    expect(within(first).getByRole('link')).toHaveAttribute('href', `/dock/trips/${TRIP_ID}`)
    expect(calls.map((call) => call.path)).toContain(`/api/v1/depots/${DEPOT_ID}/loading/runs`)
  })

  it('says so when the plan has not been published yet', async () => {
    stubApi(runs([]))
    renderScreen(<RunsPage />, '/dock')

    expect(await screen.findByText('No runs on this dock today')).toBeInTheDocument()
  })

  it('shows the problem and a retry when the board will not load', async () => {
    stubApi({
      'GET /api/v1/me': () => envelope(aMe()),
      [`GET /api/v1/depots/${DEPOT_ID}/loading/runs`]: () =>
        new Response(JSON.stringify({ code: 'INTERNAL', status: 500, title: 'Something went wrong', detail: 'The board is not available.' }), {
          status: 500,
          headers: { 'content-type': 'application/problem+json' },
        }),
    })
    renderScreen(<RunsPage />, '/dock')

    expect(await screen.findByRole('alert')).toHaveTextContent('The board is not available.')
  })
})
