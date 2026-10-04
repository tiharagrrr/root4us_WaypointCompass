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
  /** With DEMO_MODE, the worker moves running trips on the map (no phone needed). */
  SIMULATE_POSITIONS: flag('true'),
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
  /**
   * Where SMS goes - sign-in codes, invitation links and the SMS channel of
   * every notification. demo-inbox (the default) keeps them on this machine at
   * /api/v1/demo/inbox and needs DEMO_MODE=true; notifylk and textlk are Sri
   * Lankan gateways on the local operators' routes; twilio is the fallback for
   * a number that is not +94. A real gateway needs a sender id its operator
   * has approved, which takes days, so nothing but demo-inbox is the default.
   */
  SMS_PROVIDER: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .enum(['demo-inbox', 'notifylk', 'textlk', 'twilio'])
      .default('demo-inbox'),
  ),
  /** Notify.lk: the numeric user id and api key from the dashboard. */
  NOTIFYLK_USER_ID: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().optional(),
  ),
  NOTIFYLK_API_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().optional(),
  ),
  /**
   * The mask the recipient sees. Only a sender id Notify.lk has approved
   * works; NotifyDEMO, the unapproved default, reaches only the numbers
   * verified in that account.
   */
  NOTIFYLK_SENDER_ID: z.string().default('NotifyDEMO'),
  /** Text.lk: the bearer token from the dashboard, and its approved sender id. */
  TEXTLK_API_TOKEN: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().optional(),
  ),
  TEXTLK_SENDER_ID: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().optional(),
  ),
  TWILIO_ACCOUNT_SID: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().startsWith('AC').optional(),
  ),
  TWILIO_AUTH_TOKEN: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().optional(),
  ),
  /** A Twilio number in E.164, or a messaging service SID (MG...). */
  TWILIO_FROM: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().optional(),
  ),
  /** Starts the demo clock at this instant; honoured only when DEMO_MODE=true. */
  DEMO_CLOCK: z.string().optional(),
  /** The simulator (specs/simulation/spec.md); it also needs DEMO_MODE=true. */
  SIMULATION_ENABLED: flag('false'),
  /**
   * The model behind the simulator's scenario director: disabled (no model is
   * ever called), scripted (a keyless fake for local runs and tests),
   * anthropic (needs ANTHROPIC_API_KEY) or openai-compatible (any server that
   * speaks the OpenAI chat completions API; needs LLM_BASE_URL and LLM_MODEL).
   */
  LLM_PROVIDER: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .enum(['disabled', 'scripted', 'anthropic', 'openai-compatible'])
      .default('disabled'),
  ),
  ANTHROPIC_API_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().optional(),
  ),
  /**
   * Where the openai-compatible adapter posts, including the version path:
   * https://api.openai.com/v1, https://openrouter.ai/api/v1,
   * http://localhost:11434/v1 for Ollama.
   */
  LLM_BASE_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().url().optional(),
  ),
  /** The openai-compatible adapter's key; a local server needs none. */
  LLM_API_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().optional(),
  ),
  /** Unset means each adapter's own default; openai-compatible has none. */
  LLM_MODEL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().optional(),
  ),
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
