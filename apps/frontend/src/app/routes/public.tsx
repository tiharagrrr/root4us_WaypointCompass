import type { RouteObject } from 'react-router'
import { DockSignInPage } from '@/features/identity/dock-sign-in-page'
import { DriverSignInPage } from '@/features/identity/driver-sign-in-page'
import { InviteLandingPage } from '@/features/identity/invite-landing-page'
import { SignInPage } from '@/features/identity/sign-in-page'

/** Routes outside any role shell: the three ways in, the invite landing and the demo inbox. */
export const publicRoutes: RouteObject[] = [
  { path: 'sign-in', element: <SignInPage /> },
  // Drivers sign in with a code sent to their phone (D0a, D0b); loaders with a depot and a dock PIN (L1, L1m).
  { path: 'sign-in/driver', element: <DriverSignInPage /> },
  { path: 'sign-in/dock', element: <DockSignInPage /> },
  { path: 'invite/:token', element: <InviteLandingPage /> },
  // Demo mode only: the inbox of every email and SMS sent (GET /demo/inbox). No frame.
  {
    path: 'demo/inbox',
    lazy: async () => ({ Component: (await import('@/features/identity/demo-inbox-page')).DemoInboxPage }),
  },
]
