import { db, META_KEYS, type CompassDb, type OutboxRow } from './db'
import { isUrgent } from './events'
import { deviceId, setSyncPoke } from './outbox'

/** specs/sync/spec.md: a batch holds at most 100 events. */
export const BATCH_LIMIT = 100
/** Retry after 2, 5, 15, 30, then every 60 seconds. */
export const BACKOFF_SECONDS = [2, 5, 15, 30, 60] as const

export type ItemStatus = 'applied' | 'duplicate' | 'conflict' | 'rejected'

export interface SyncItemResult {
  clientUuid: string
  status: ItemStatus
  code?: string
  message?: string
}

export interface SyncTransport {
  (body: { deviceId: string; events: unknown[] }): Promise<{ results: SyncItemResult[] }>
}

export const backoffMs = (attempts: number): number =>
  BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length - 1)] * 1000

/**
 * POST /sync does not exist yet: ROO-44 owns it, together with widening `stopEventSchema` to carry
 * the trip-level events, deviceSeq, baseVersion, lines and attachments. Until it lands this posts
 * the batch and MSW answers it, so the queue, the ordering, the retry schedule and every per-item
 * verdict are exercised for real and only the far end is a mock.
 */
export const postSync: SyncTransport = async (body) => {
  const response = await fetch('/api/v1/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sync-version': '1' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  })
  if (response.status === 401) throw new PausedError()
  if (!response.ok) throw new Error(`sync failed: ${response.status}`)
  return (await response.json()) as { results: SyncItemResult[] }
}

/** A 401 pauses sync and keeps the outbox: nothing queued is ever dropped. */
export class PausedError extends Error {
  constructor() {
    super('sync paused: not signed in')
    this.name = 'PausedError'
  }
}

export interface SyncEngineOptions {
  database?: CompassDb
  transport?: SyncTransport
  /** Injected in tests so the schedule can be checked without waiting. */
  now?: () => Date
}

export class SyncEngine {
  private readonly db: CompassDb
  private readonly transport: SyncTransport
  private readonly now: () => Date
  private running = false
  private paused = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(options: SyncEngineOptions = {}) {
    this.db = options.database ?? db
    this.transport = options.transport ?? postSync
    this.now = options.now ?? (() => new Date())
  }

  /** Wire the outbox's poke to this engine and flush whatever the last session left behind. */
  start(): void {
    setSyncPoke(({ urgent }) => {
      void this.flush({ urgentOnly: urgent && this.paused })
    })
    void this.flush()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    setSyncPoke(() => {})
  }

  /** A 401 pauses; signing back in resumes without losing a single queued tap. */
  resume(): void {
    this.paused = false
    void this.flush()
  }

  async flush(opts: { urgentOnly?: boolean } = {}): Promise<void> {
    if (this.running || (this.paused && !opts.urgentOnly)) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    this.running = true
    try {
      const batch = await this.dueRows(opts.urgentOnly ?? false)
      if (batch.length === 0) return
      await this.send(batch)
    } catch (error) {
      if (error instanceof PausedError) this.paused = true
      await this.penalise()
    } finally {
      this.running = false
    }
    await this.scheduleNext()
  }

  /** Pending rows whose backoff has elapsed, in the order they were tapped. */
  private async dueRows(urgentOnly: boolean): Promise<OutboxRow[]> {
    const nowIso = this.now().toISOString()
    const rows = await this.db.outbox
      .where('status')
      .anyOf('pending', 'sending')
      .sortBy('deviceSeq')
    return rows
      .filter((row) => row.nextAttemptAt === null || row.nextAttemptAt <= nowIso)
      .filter((row) => !urgentOnly || isUrgent(row.event))
      .slice(0, BATCH_LIMIT)
  }

  private async send(batch: OutboxRow[]): Promise<void> {
    const seqs = batch.map((row) => row.deviceSeq!).filter((s) => s !== undefined)
    await this.db.outbox.where('deviceSeq').anyOf(seqs).modify({ status: 'sending' })

    const { results } = await this.transport({
      deviceId: await deviceId(this.db),
      events: batch.map(toWireEvent),
    })

    const byUuid = new Map(results.map((r) => [r.clientUuid, r]))
    for (const row of batch) {
      const result = byUuid.get(row.clientUuid)
      if (!result) {
        // The server said nothing about this one: leave it pending and try again.
        await this.db.outbox.update(row.deviceSeq!, { status: 'pending' })
        continue
      }
      // `applied` and `duplicate` both mean the server holds it: the row's work is done.
      if (result.status === 'applied' || result.status === 'duplicate') {
        await this.db.outbox.delete(row.deviceSeq!)
        continue
      }
      await this.db.outbox.update(row.deviceSeq!, {
        status: result.status,
        code: result.code,
        message: result.message,
        attempts: row.attempts + 1,
      })
    }
    await this.db.meta.put({ key: META_KEYS.lastSyncAt, value: this.now().toISOString() })
  }

  /** A network or 5xx failure: every row in flight waits out its own backoff. */
  private async penalise(): Promise<void> {
    const rows = await this.db.outbox.where('status').equals('sending').toArray()
    for (const row of rows) {
      // The wait comes from the failures already behind this row, so the first one waits 2s.
      const waitMs = backoffMs(row.attempts)
      await this.db.outbox.update(row.deviceSeq!, {
        status: 'pending',
        attempts: row.attempts + 1,
        nextAttemptAt: new Date(this.now().getTime() + waitMs).toISOString(),
      })
    }
  }

  private async scheduleNext(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    const next = await this.db.outbox.where('status').equals('pending').first()
    if (!next) return
    const waitMs = next.nextAttemptAt
      ? Math.max(0, Date.parse(next.nextAttemptAt) - this.now().getTime())
      : 0
    this.timer = setTimeout(() => void this.flush(), Math.max(waitMs, 1000))
  }
}

/**
 * Flatten one outbox row into what `POST /sync` takes. The device keeps `kind` to pick its reducer;
 * the server tells driver from loader by the event type, so it is not sent.
 */
export function toWireEvent(row: OutboxRow): Record<string, unknown> {
  const event: Record<string, unknown> = { ...row.event }
  delete event.kind
  return {
    ...event,
    clientUuid: row.clientUuid,
    occurredAt: row.occurredAt,
    deviceTime: row.deviceTime,
    deviceSeq: row.deviceSeq,
  }
}
