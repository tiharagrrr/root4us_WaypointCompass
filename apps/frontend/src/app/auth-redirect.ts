import { onUnauthenticated } from '@compass/api-client'
import { router } from './router'

/** Paths that work signed out; a 401 there is the screen's own business. */
const PUBLIC_PREFIXES = ['/sign-in', '/invite/', '/demo/']

const under = (pathname: string, area: string): boolean => pathname === area || pathname.startsWith(`${area}/`)

/**
 * Each area's own way in: the dock keypad for /dock (L1), the phone code for /driver (D0a), the
 * password form for everyone else (A0). A loader bounced to the password form had no way back.
 */
export const signInPathFor = (pathname: string): string => {
  if (under(pathname, '/dock')) return '/sign-in/dock'
  if (under(pathname, '/driver')) return '/sign-in/driver'
  return '/sign-in'
}

/**
 * Any 401 from the API (no session, or it was revoked by a role change) sends the person to
 * sign in, then back to where they were.
 */
export function redirectToSignInOn401(): () => void {
  return onUnauthenticated(() => {
    const { pathname, search } = router.state.location
    if (pathname === '/' || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return
    void router.navigate(`${signInPathFor(pathname)}?next=${encodeURIComponent(pathname + search)}`, { replace: true })
  })
}
