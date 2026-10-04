import 'fake-indexeddb/auto'
import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, enqueue, META_KEYS, PausedError, setSyncPoke, SyncEngine, type SyncItemResult } from '@/offline'
import { renderScreen } from '@/test/api-stub'
import { DriverOfflineBanner } from '../driver-offline-banner'

const queue = async (count: number) => {
  for (let i = 0; i < count; i += 1)
    await enqueue({ kind: 'driver', type: 'ARRIVED', tripId: 'trip-1', stopId: `stop-${i}` })
}

const setOnline = (onLine: boolean) => vi.stubGlobal('navigator', { ...navigator, onLine })

const applied = async (body: { events: unknown[] }): Promise<{ results: SyncItemResult[] }> => ({
  results: body.events.map((e) => ({ clientUuid: (e as { clientUuid: string }).clientUuid, status: 'applied' as const })),
})

describe('D6 Offline banner', () => {
  beforeEach(async () => {
    setSyncPoke(() => {})
    await db.open()
    await Promise.all([db.outbox.clear(), db.meta.clear()])
  })
  afterEach(() => vi.unstubAllGlobals())

  it('is not there while signal and the session are fine', async () => {
    setOnline(true)
    await queue(2)
    renderScreen(<DriverOfflineBanner />)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('counts the records waiting and says when the last batch got through', async () => {
    setOnline(false)
    await queue(3)
    await db.meta.put({ key: META_KEYS.lastSyncAt, value: '2026-10-02T04:10:00+05:30' })
    renderScreen(<DriverOfflineBanner />)

    expect(await screen.findByText('No signal. 3 records waiting to send.')).toBeInTheDocument()
    expect(screen.getByText(/Last sent 04:10/)).toBeInTheDocument()
  })

  it('says so when nothing has ever been sent, and when nothing is waiting', async () => {
    setOnline(false)
    renderScreen(<DriverOfflineBanner />)
    expect(await screen.findByText('No signal. Everything recorded so far has been sent.')).toBeInTheDocument()
    expect(screen.getByText(/Nothing sent from this phone yet/)).toBeInTheDocument()
  })

  it('AC-SYN-14 a 401 pauses sync and loses nothing', async () => {
    setOnline(true)
    await queue(3)
    renderScreen(<DriverOfflineBanner />)

    // Her session has expired: the reconnect's POST /sync is refused with 401.
    const engine = new SyncEngine({ database: db, transport: () => Promise.reject(new PausedError()) })
    await engine.flush()

    expect(await screen.findByText('Sign in to send 3 records')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in/driver')
    await expect(db.outbox.count()).resolves.toBe(3)
    // A paused engine sends nothing, however often it is poked.
    const transport = vi.fn(applied)
    const paused = new SyncEngine({ database: db, transport })
    Object.assign(paused, { paused: true })
    await paused.flush()
    expect(transport).not.toHaveBeenCalled()

    // She signs back in: the same three records go, the outbox empties, the banner goes.
    const resumed = new SyncEngine({ database: db, transport: applied })
    resumed.resume()
    await waitFor(() => expect(db.outbox.count()).resolves.toBe(0))
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })
})
