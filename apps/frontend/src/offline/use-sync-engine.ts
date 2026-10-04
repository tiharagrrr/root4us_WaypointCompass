import { useEffect } from 'react'
import { SyncEngine } from './sync-engine'

/** One engine per tab: it owns the outbox's poke, so a second one would steal it. */
const sharedEngine = new SyncEngine()

/**
 * Keeps the outbox draining while a dock tablet or a driver's phone is open. Every tap is already
 * safe in Dexie the moment it is made (architecture rule 10); this is what sends it. Starting it
 * flushes whatever the last session left behind, a queued tap pokes it to flush, and coming back
 * online flushes at once instead of waiting out the retry timer. A 401 pauses the engine, so
 * mounting after a fresh sign-in resumes it.
 *
 * `engine` is a parameter so a test can hand in one wired to a throwaway database.
 */
export function useSyncEngine(engine: SyncEngine = sharedEngine): void {
  useEffect(() => {
    engine.resume()
    engine.start()
    const flush = () => void engine.flush()
    window.addEventListener('online', flush)
    return () => {
      window.removeEventListener('online', flush)
      engine.stop()
    }
  }, [engine])
}
