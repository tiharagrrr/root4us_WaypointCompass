import 'fake-indexeddb/auto'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CompassDb } from '../db'
import { uuidv7 } from '../ids'
import { enqueue, pendingCount, setSyncPoke } from '../outbox'
import { SyncEngine, type SyncItemResult } from '../sync-engine'
import { useSyncEngine } from '../use-sync-engine'

let db: CompassDb

beforeEach(async () => {
  setSyncPoke(() => {})
  db = new CompassDb(`test-${uuidv7()}`)
  await db.open()
  vi.stubGlobal('navigator', { onLine: true })
})

function Host({ engine }: { engine: SyncEngine }) {
  useSyncEngine(true, engine)
  return null
}

const applied = async (body: { events: unknown[] }): Promise<{ results: SyncItemResult[] }> => ({
  results: body.events.map((e) => ({ clientUuid: (e as { clientUuid: string }).clientUuid, status: 'applied' as const })),
})

const flagEvent = {
  kind: 'loader',
  type: 'LOAD_FLAG_RAISED',
  tripId: '0192a3f4-0000-7000-8000-00000000a001',
  loadLineId: '0192a3f4-0000-7000-8000-00000000b001',
  reason: 'DAMAGED',
  qtyAffected: 8,
} as const

describe('useSyncEngine', () => {
  it('sends a tap queued while the shell is open, without anyone starting the engine by hand', async () => {
    const transport = vi.fn(applied)
    render(<Host engine={new SyncEngine({ database: db, transport })} />)

    await enqueue(flagEvent, db)

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1))
    const sent = transport.mock.calls[0][0].events[0] as { type: string; clientUuid: string }
    expect(sent.type).toBe('LOAD_FLAG_RAISED')
    await waitFor(async () => expect(await pendingCount(db)).toBe(0))
  })

  it('flushes what the last session left behind as soon as it mounts', async () => {
    await enqueue(flagEvent, db)
    expect(await pendingCount(db)).toBe(1)
    const transport = vi.fn(applied)

    render(<Host engine={new SyncEngine({ database: db, transport })} />)

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1))
    await waitFor(async () => expect(await pendingCount(db)).toBe(0))
  })

  it('stops poking the engine when the shell goes away', async () => {
    const transport = vi.fn(applied)
    const { unmount } = render(<Host engine={new SyncEngine({ database: db, transport })} />)
    unmount()

    await enqueue(flagEvent, db)

    // The tap is safe in the queue, and nothing sent it.
    expect(await pendingCount(db)).toBe(1)
    expect(transport).not.toHaveBeenCalled()
  })
})
