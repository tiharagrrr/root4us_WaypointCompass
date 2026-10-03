export interface DevicePosition {
  lat: number
  lng: number
}

/**
 * Where the phone thinks it is, for the stop events that carry a position (AC-EXE-08). Best effort
 * on purpose: a driver standing under a mall dock may get no fix for a minute, and an arrival that
 * waits for GPS is an arrival that never gets recorded. A null position is recorded as null.
 */
export async function devicePosition(timeoutMs = 4000): Promise<DevicePosition | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null
  return new Promise((resolve) => {
    let settled = false
    const done = (value: DevicePosition | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const timer = setTimeout(() => done(null), timeoutMs)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer)
        done({ lat: position.coords.latitude, lng: position.coords.longitude })
      },
      () => {
        clearTimeout(timer)
        done(null)
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    )
  })
}
