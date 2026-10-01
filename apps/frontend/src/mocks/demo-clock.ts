const KEY = 'compass.mock.now'

/**
 * The instant the hand-built mocks answer from. It is real time unless a demo pins it, which is
 * how M2 (the cutoff passed) and any other time-dependent state are shown on demand:
 *
 *   compassMock.setNow('2026-10-01T16:12:00+05:30')   // M2
 *   compassMock.setNow(null)                          // back to real time
 *
 * Development only; the real API's clock is GET /api/v1/clock and A6's time travel.
 */
export const mockNow = (): Date => {
  try {
    const pinned = globalThis.localStorage?.getItem(KEY)
    if (pinned) return new Date(pinned)
  } catch {
    // Private mode or blocked storage: real time is fine.
  }
  return new Date()
}

export const setMockNow = (iso: string | null): void => {
  try {
    if (iso === null) globalThis.localStorage?.removeItem(KEY)
    else globalThis.localStorage?.setItem(KEY, iso)
  } catch {
    // Nothing to do: the demo falls back to real time.
  }
}
