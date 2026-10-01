import { onUnauthenticated } from '@compass/api-client'
import { router } from './router'

/** Paths that work signed out; a 401 there is the screen's own business. */
const PUBLIC_PREFIXES = ['/sign-in', '/invite/', '/demo/']

/**
 * Any 401 from the API (no session, or it was revoked by a role change) sends the person to
 * sign in, then back to where they were.
 */
export function redirectToSignInOn401(): () => void {
  return onUnauthenticated(() => {
    const { pathname, search } = router.state.location
    if (pathname === '/' || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return
    void router.navigate(`/sign-in?next=${encodeURIComponent(pathname + search)}`, { replace: true })
  })
}
