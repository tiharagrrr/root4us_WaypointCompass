import { z } from 'zod';

const flag = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((v) => v === 'true');

/** Validated at boot; documented in apps/backend/.env.example. */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  APP_URL: z.url().default('http://localhost:8080'),
  BETTER_AUTH_SECRET: z.string().min(16),
  /** Extra origins allowed to call /api/auth, comma-separated (the Vite dev server). */
  TRUSTED_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  /** Bearer tokens for the Flutter app; off until it exists. */
  ENABLE_BEARER: flag('false'),
  /** Demo clock, demo reset and the demo inbox of SMS and emails. */
  DEMO_MODE: flag('false'),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('pod'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /**
   * Where email goes: resend (real sends), or demo-inbox (/demo/inbox, needs
   * DEMO_MODE=true). Empty picks resend when RESEND_API_KEY is set, else the
   * demo inbox.
   */
  EMAIL_PROVIDER: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['resend', 'demo-inbox']).optional(),
  ),
  RESEND_API_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().startsWith('re_').optional(),
  ),
  /** The From line, on a domain verified in Resend. */
  EMAIL_FROM: z.string().default('Waypoint Compass <onboarding@resend.dev>'),
  /** The whsec_ signing secret of the Resend webhook (delivery receipts). */
  RESEND_WEBHOOK_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().startsWith('whsec_').optional(),
  ),
  /** Starts the demo clock at this instant; honoured only when DEMO_MODE=true. */
  DEMO_CLOCK: z.string().optional(),
  /** pino level; defaults to debug in development, error in tests, info otherwise. */
  LOG_LEVEL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .optional(),
  ),
  /** Build version in every log line, e.g. 1.4.0+abc123. */
  APP_VERSION: z.string().default('0.0.1'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
