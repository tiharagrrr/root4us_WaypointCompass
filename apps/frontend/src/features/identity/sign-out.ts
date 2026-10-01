import { useNavigate } from 'react-router'
import { useCallback } from 'react'
import { queryClient } from '@/app/query-client'
import { authClient } from './auth-client'

/**
 * Ends the session and goes back to the right sign-in screen: the dock keypad for a shared tablet
 * (L1 "Switch user"), the phone code for a driver (D13), the password form for everyone else.
 * The cache is cleared first, so the next person never sees the last one's data.
 */
export const useSignOut = (signInPath = '/sign-in'): (() => Promise<void>) => {
  const navigate = useNavigate()
  return useCallback(async () => {
    await authClient.signOut()
    queryClient.clear()
    await navigate(signInPath, { replace: true })
  }, [navigate, signInPath])
}
