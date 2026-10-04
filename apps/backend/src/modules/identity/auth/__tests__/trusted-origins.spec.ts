import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../../config/env.schema';
import { trustedOrigins } from '../auth.module';

const config = (values: Partial<Env>) =>
  ({ get: (key: keyof Env) => values[key] }) as unknown as ConfigService<
    Env,
    true
  >;

describe('trustedOrigins', () => {
  it('trusts the Vite dev server outside production, so a fresh checkout can sign in', () => {
    expect(
      trustedOrigins(config({ NODE_ENV: 'development', TRUSTED_ORIGINS: [] })),
    ).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173']);
  });

  it('adds the configured origins once each, for phones on the LAN', () => {
    expect(
      trustedOrigins(
        config({
          NODE_ENV: 'development',
          TRUSTED_ORIGINS: [
            'http://192.168.1.20:5173',
            'http://localhost:5173',
          ],
        }),
      ),
    ).toEqual([
      'http://192.168.1.20:5173',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
  });

  it('trusts only what is configured in production', () => {
    expect(
      trustedOrigins(
        config({
          NODE_ENV: 'production',
          TRUSTED_ORIGINS: ['https://waypoint.example.com'],
        }),
      ),
    ).toEqual(['https://waypoint.example.com']);
  });
});
