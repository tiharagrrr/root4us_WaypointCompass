import 'fake-indexeddb/auto'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/offline'
import { envelope, renderScreen, stubApi } from '@/test/api-stub'
import { ReleaseTripPage } from '../release-trip-page'
import { aLoadList, aMe, aTripSummary, releaseChecks, TRIP_ID } from './fixtures'

const open = (checks: Record<string, unknown> = releaseChecks(), extra: Record<string, unknown> = {}) => {
  const stub = stubApi({
    'GET /api/v1/me': () => envelope(aMe()),
    [`GET /api/v1/trips/${TRIP_ID}/load-list`]: () => envelope(aLoadList()),
    [`GET /api/v1/trips/${TRIP_ID}/release-checks`]: () => envelope(checks),
    ...extra,
  })
  renderScreen(
    <Routes>
      <Route path="/dock/trips/:id/release" element={<ReleaseTripPage />} />
      <Route path="/dock/trips/:id" element={<p>Loading list</p>} />
    </Routes>,
    `/dock/trips/${TRIP_ID}/release`,
  )
  return stub
}

describe('L4 Release trip', () => {
  beforeEach(async () => {
    await db.open()
    await Promise.all([db.outbox.clear(), db.loadLines.clear(), db.loadFlags.clear(), db.meta.clear()])
    await db.meta.put({ key: 'checkedByName', value: 'Harini De Mel' })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    // The offline event reaches TanStack Query's own online manager, which outlives the render.
    window.dispatchEvent(new Event('online'))
  })

  it('AC-LOD-14 draws every precondition, pass or fail, and will not release while one fails', async () => {
    open()

    const rows = await screen.findAllByRole('listitem')
    const checks = rows.filter((row) => row.dataset.slot === 'release-check')
    expect(checks.map((row) => row.dataset.pass)).toEqual(['true', 'true', 'true', 'false'])
    expect(screen.getByText('Reefer temperature check')).toBeInTheDocument()
    expect(screen.getByText('Required for chilled loads · target 0–4 °C')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Release trip' })).toBeDisabled()
  })

  it('AC-LOD-15 sends the reefer reading the loader typed', async () => {
    const user = userEvent.setup()
    const { calls } = open(releaseChecks({ canRelease: true }))

    await user.type(await screen.findByLabelText('Reefer temperature in °C'), '3.4')
    await user.click(screen.getByRole('button', { name: 'Release trip' }))

    await waitFor(() => {
      const posted = calls.find((call) => call.method === 'POST')
      expect(posted?.path).toBe(`/api/v1/trips/${TRIP_ID}/release`)
      expect(posted?.body).toMatchObject({ reeferTempC: 3.4, checkedByName: 'Harini De Mel', planRevision: 1 })
    })
  })

  it('AC-LOD-16 a released trip shows L5 with the temperature, the checker and the next run', async () => {
    const user = userEvent.setup()
    const released = aLoadList()
    released.trip = { ...released.trip, status: 'RELEASED', releasedAt: '2026-10-02T05:38:00+05:30', releaseTempC: 3.4 }
    released.releasedByName = 'Harini De Mel'
    open(releaseChecks({ canRelease: true }), {
      [`POST /api/v1/trips/${TRIP_ID}/release`]: () => envelope(released),
      [`GET /api/v1/depots/PLG/loading/trips`]: () => ({
        data: [aTripSummary({ id: 'trip-ref-03', vehicleId: 'REF-03', status: 'PLANNED', plannedDepartAt: '2026-10-02T05:50:00+05:30' })],
      }),
    })

    await user.click(await screen.findByRole('button', { name: 'Release trip' }))

    expect(await screen.findByRole('heading', { name: 'REF-07 released' })).toBeInTheDocument()
    expect(screen.getByText('05:38 · Sent to Aniqa Razick’s phone. 2 stores see their order as Loaded.')).toBeInTheDocument()
    expect(screen.getByText('3.4 °C')).toBeInTheDocument()
    expect(screen.getByText('Harini De Mel')).toBeInTheDocument()
    expect(screen.getByText('REF-03 · Fresh · departs 05:50')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start loading' })).toHaveAttribute('href', '/dock/trips/trip-ref-03')
  })

  it('AC-LOD-17 offline, release says it needs a connection and queues nothing', async () => {
    const user = userEvent.setup()
    const { calls } = open(releaseChecks({ canRelease: true }))
    // The dock is online when she opens L4; the wifi goes behind a parked reefer while she reads it.
    const button = await screen.findByRole('button', { name: 'Release trip' })
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => window.dispatchEvent(new Event('offline')))

    expect(await screen.findByText(/Releasing needs a connection/)).toBeInTheDocument()
    expect(button).toBeDisabled()
    await user.click(button)

    // Release is the one loader write the outbox does not take: it has to confirm the revision.
    expect(await db.outbox.count()).toBe(0)
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('takes the server’s new answer when the release is refused', async () => {
    const user = userEvent.setup()
    let asked = 0
    open(releaseChecks({ canRelease: true }), {
      [`POST /api/v1/trips/${TRIP_ID}/release`]: () =>
        new Response(
          JSON.stringify({ code: 'CONFLICT_STATE', status: 409, title: 'Not ready to release', detail: 'One line is still open.' }),
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
    })
    asked += 1

    await user.click(await screen.findByRole('button', { name: 'Release trip' }))
    expect(await screen.findByText('One line is still open.')).toBeInTheDocument()
    expect(asked).toBe(1)
  })
})
