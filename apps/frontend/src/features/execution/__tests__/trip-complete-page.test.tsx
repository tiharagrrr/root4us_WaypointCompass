import 'fake-indexeddb/auto'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, setSyncPoke } from '@/offline'
import { renderScreen } from '@/test/api-stub'
import { TripCompletePage } from '../trip-complete-page'
import { saveBundle } from '../trip-bundle'
import { aBundle, STOP_IDS, TRIP_ID } from './fixtures'

/** D7 reads :id from the route, so each test renders it behind the real path. */
const renderDone = () =>
  renderScreen(
    <Routes>
      <Route path="/driver/trips/:id/done" element={<TripCompletePage />} />
      <Route path="/driver" element={<p>Today’s trip</p>} />
      <Route path="/driver/stops/:id" element={<p>Next stop</p>} />
    </Routes>,
    `/driver/trips/${TRIP_ID}/done`,
  )

/** The round as it stands at the end: every stop carries a result. */
const finishedRound = async () => {
  await saveBundle(aBundle(), db)
  await db.trips.update(TRIP_ID, { status: 'IN_PROGRESS' })
  await Promise.all(STOP_IDS.map((id) => db.stops.update(id, { status: 'DELIVERED' })))
}

beforeEach(async () => {
  setSyncPoke(() => {})
  await db.open()
  await Promise.all([db.trips.clear(), db.stops.clear(), db.stopLines.clear(), db.outbox.clear(), db.meta.clear()])
})

describe('D7 Trip complete', () => {
  it('AC-EXE-15 finishing the trip queues TRIP_COMPLETED through the outbox', async () => {
    await finishedRound()
    renderDone()

    await userEvent.click(await screen.findByRole('button', { name: 'Finish trip' }))

    // The one way a driver screen writes: an outbox row, never a mutation hook (rule 10).
    await waitFor(async () => {
      const queued = await db.outbox.toArray()
      expect(queued).toHaveLength(1)
    })
    const [row] = await db.outbox.toArray()
    expect(row?.event).toMatchObject({ kind: 'driver', type: 'TRIP_COMPLETED', tripId: TRIP_ID })
    expect(row?.status).toBe('pending')
    // The device makes the clientUuid, and the event carries the version it saw.
    expect(row?.clientUuid).toBeTruthy()
    expect(row?.event).toHaveProperty('baseVersion')
  })

  it('AC-EXE-15 moves the cached trip to COMPLETED so the screen updates offline', async () => {
    await finishedRound()
    renderDone()

    await userEvent.click(await screen.findByRole('button', { name: 'Finish trip' }))

    await waitFor(async () => {
      expect((await db.trips.get(TRIP_ID))?.status).toBe('COMPLETED')
    })
    // Reading through useLiveQuery, the screen turns over to its finished state with no refetch.
    expect(await screen.findByRole('heading', { name: 'Trip finished', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Finish trip' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to today’s trip' })).toBeInTheDocument()
  })

  it('AC-EXE-15 will not finish a trip that still has an open stop', async () => {
    await saveBundle(aBundle(), db)
    await db.trips.update(TRIP_ID, { status: 'IN_PROGRESS' })
    await Promise.all(STOP_IDS.slice(0, 5).map((id) => db.stops.update(id, { status: 'DELIVERED' })))
    // STOP_IDS[5] is left PENDING.
    renderDone()

    expect(await screen.findByText(/Stops still to record/)).toBeInTheDocument()
    expect(screen.getByText('Fresh Minuwangoda', { exact: false })).toBeInTheDocument()
    // No link from the trip machine means no button at all, the same answer the server gives.
    expect(screen.queryByRole('button', { name: 'Finish trip' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the next stop' })).toBeInTheDocument()
  })

  it('summarises the run by outcome', async () => {
    await saveBundle(aBundle(), db)
    await db.trips.update(TRIP_ID, { status: 'IN_PROGRESS' })
    await db.stops.update(STOP_IDS[0], { status: 'DELIVERED' })
    await db.stops.update(STOP_IDS[1], { status: 'DELIVERED' })
    await db.stops.update(STOP_IDS[2], { status: 'DELIVERED' })
    await db.stops.update(STOP_IDS[3], { status: 'DELIVERED' })
    await db.stops.update(STOP_IDS[4], { status: 'PARTIAL' })
    await db.stops.update(STOP_IDS[5], { status: 'FAILED' })
    renderDone()

    expect(await screen.findByText('Summary of the run')).toBeInTheDocument()
    const row = (label: string) => screen.getByText(label).closest('div')
    expect(row('Delivered')).toHaveTextContent('4')
    expect(row('Partial')).toHaveTextContent('1')
    expect(row('Could not deliver')).toHaveTextContent('1')
    // Every stop has a result, so the round can still be closed.
    expect(screen.getByRole('button', { name: 'Finish trip' })).toBeInTheDocument()
  })

  it('refuses a trip this phone is not running', async () => {
    await saveBundle(aBundle(), db)
    // Still RELEASED: the driver never started it, so there is no run to summarise.
    renderDone()

    expect(await screen.findByText('That stop is not on this trip')).toBeInTheDocument()
  })
})
