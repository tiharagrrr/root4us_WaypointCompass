import { serverNow } from '@/lib/server-clock'
import { applyOptimistic } from './apply-optimistic'
import { db, META_KEYS, type CompassDb, type OutboxRow } from './db'
import { isUrgent, type QueuedEvent } from './events'
import { uuidv7 } from './ids'

/** Woken after every enqueue so a queued write leaves as soon as there is a connection. */
type Poke = (opts: { urgent: boolean }) => void
let poke: Poke = () => {}
export const setSyncPoke = (next: Poke): void => {
  poke = next
}

export interface EnqueueResult {
  clientUuid: string
  deviceSeq: number
}

/**
 * The only way a driver or loader screen writes (architecture rule 10). One Dexie transaction adds
 * the outbox row and moves the cache, so a screen reading through `useLiveQuery` shows the tap
 * immediately and identically with or without signal. The network is not involved: `poke` only
 * asks the sync engine to look, and the tap survives if it never gets through.
 */
export async function enqueue(
  event: QueuedEvent,
  database: CompassDb = db,
): Promise<EnqueueResult> {
  const clientUuid = uuidv7()
  // The server-aligned time is what the event happened at; the raw device clock is kept beside it
  // so a phone with a wrong clock can still be explained on the timeline.
  const occurredAt = serverNow().toISOString()
  const deviceTime = new Date().toISOString()

  const row: OutboxRow = {
    clientUuid,
    event,
    status: 'pending',
    occurredAt,
    deviceTime,
    attempts: 0,
    nextAttemptAt: null,
  }

  const deviceSeq = await database.transaction(
    'rw',
    [
      database.outbox,
      database.trips,
      database.stops,
      database.loadLines,
      database.loadFlags,
    ],
    async () => {
      const seq = await database.outbox.add(row)
      await applyOptimistic(database, event, clientUuid)
      return seq as number
    },
  )

  poke({ urgent: isUrgent(event) })
  return { clientUuid, deviceSeq }
}

/** What D6 and the dock's offline banner show: how many taps are still waiting. */
export const pendingCount = (database: CompassDb = db): Promise<number> =>
  database.outbox.where('status').anyOf('pending', 'sending').count()

export const conflictCount = (database: CompassDb = db): Promise<number> =>
  database.outbox.where('status').equals('conflict').count()

/** This device's stable id, made once and kept, so the server can tell two phones apart. */
export async function deviceId(database: CompassDb = db): Promise<string> {
  const row = await database.meta.get(META_KEYS.deviceId)
  if (typeof row?.value === 'string') return row.value
  const made = uuidv7()
  await database.meta.put({ key: META_KEYS.deviceId, value: made })
  return made
}
