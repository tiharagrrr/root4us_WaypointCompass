import type { Database } from '../../../../db/client';
import { createAuth } from '../auth';

/** No query runs: $context only builds the options, cookies and plugins. */
const deps = {
  db: {} as Database,
  secret: 'unit-test-secret-that-is-long-enough',
  sendOtp: () => Promise.resolve(),
};

describe('session cookie Secure flag', () => {
  it('is a plain cookie when APP_URL is http, so localhost and LAN phones keep the session', async () => {
    const ctx = await createAuth({ ...deps, appUrl: 'http://localhost:8080' })
      .$context;
    expect(ctx.authCookies.sessionToken.attributes.secure).toBe(false);
    expect(ctx.authCookies.sessionToken.name).toBe('better-auth.session_token');
  });

  it('is Secure when APP_URL is https', async () => {
    const ctx = await createAuth({
      ...deps,
      appUrl: 'https://waypoint.example.com',
    }).$context;
    expect(ctx.authCookies.sessionToken.attributes.secure).toBe(true);
    expect(ctx.authCookies.sessionToken.name).toBe(
      '__Secure-better-auth.session_token',
    );
  });
});
