import { getDeviceId, useMeRegisterDevice } from '@compass/api-client'
import { useEffect } from 'react'

/** The user this browser last registered for, so the call goes out once per sign-in, not per screen. */
let registeredFor: string | null = null

/**
 * Tells the API about this browser as soon as someone is signed in (POST /me/devices), so it shows
 * up on A6's dock-tablet list and an admin can mark it as a depot's dock tablet. Without this a
 * tablet never registered, and PIN sign-in (which only a registered dock device may use,
 * AC-IDN-02) had nothing to accept.
 */
export function useRegisterDevice(userId: string | undefined): void {
  const { mutate } = useMeRegisterDevice()
  useEffect(() => {
    if (!userId || registeredFor === userId) return
    registeredFor = userId
    const standalone = globalThis.matchMedia?.('(display-mode: standalone)').matches ?? false
    mutate(
      { data: { id: getDeviceId(), platform: standalone ? 'PWA' : 'WEB' } },
      {
        onError: () => {
          registeredFor = null
        },
      },
    )
  }, [userId, mutate])
}

/** Tests only: forget the last registration. */
export const resetDeviceRegistration = (): void => {
  registeredFor = null
}
