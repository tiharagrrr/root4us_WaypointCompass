import type { RouteObject } from 'react-router'
import { DockSignInPage } from '@/features/identity/dock-sign-in-page'
import { InviteLandingPage } from '@/features/identity/invite-landing-page'
import { SignInPage } from '@/features/identity/sign-in-page'
import { CentredPlaceholder } from '../centred-placeholder'

/** Routes outside any role shell: the three ways in, the invite landing and the demo inbox. */
export const publicRoutes: RouteObject[] = [
  { path: 'sign-in', element: <SignInPage /> },
  // Drivers sign in with a code sent to their phone (D0a, D0b); loaders with a depot and a dock PIN (L1, L1m).
  { path: 'sign-in/driver', element: <CentredPlaceholder code="D0a" name="Sign in · driver" node="244:828" /> },
  { path: 'sign-in/dock', element: <DockSignInPage /> },
  { path: 'invite/:token', element: <InviteLandingPage /> },
  // Demo mode only: the inbox of every email, SMS and push sent (GET /demo/inbox). No frame.
  { path: 'demo/inbox', element: <CentredPlaceholder code="Demo" name="Demo inbox" /> },
]
