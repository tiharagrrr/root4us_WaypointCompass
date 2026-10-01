import { createAuthClient } from 'better-auth/client'
import { phoneNumberClient, usernameClient } from 'better-auth/client/plugins'

/**
 * BetterAuth's own client for /api/auth (sign-in, sign-out, phone codes). These routes are not in
 * the OpenAPI document, so they have no generated hooks; this is the one other way the web app
 * talks to the API. Same origin, session cookie only.
 */
export const authClient = createAuthClient({
  baseURL: globalThis.location?.origin,
  basePath: '/api/auth',
  plugins: [usernameClient(), phoneNumberClient()],
})
