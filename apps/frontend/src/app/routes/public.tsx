import type { RouteObject } from 'react-router'
import { InviteLandingPage } from '@/features/identity/invite-landing-page'
import { SignInPage } from '@/features/identity/sign-in-page'
import { CentredPlaceholder } from '../centred-placeholder'

/** Routes outside any role shell. */
export const publicRoutes: RouteObject[] = [
  { path: 'sign-in', element: <SignInPage /> },
  { path: 'invite/:token', element: <InviteLandingPage /> },
  // Demo mode only: the inbox of every email, SMS and push sent (GET /demo/inbox). No frame.
  { path: 'demo/inbox', element: <CentredPlaceholder code="Demo" name="Demo inbox" /> },
]
