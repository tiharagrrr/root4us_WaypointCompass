import { createHmac, timingSafeEqual } from 'node:crypto';

/** How far a signed timestamp may drift from now before it is a replay (specs/webhooks). */
export const SVIX_TOLERANCE_MS = 5 * 60 * 1000;

export interface SvixHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

export type SvixCheck =
  { ok: true; id: string } | { ok: false; id: string | null; reason: string };

/**
 * Resend signs its webhooks the Svix way: `v1,<base64 HMAC-SHA256>` of
 * `<svix-id>.<svix-timestamp>.<raw body>`, keyed by the base64 secret after
 * `whsec_`. The header may carry several signatures (during a secret
 * rotation); any one matching is enough. Comparison is constant-time.
 */
export function verifySvix(
  secret: string,
  headers: SvixHeaders,
  body: Buffer,
  now: Date,
): SvixCheck {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature)
    return { ok: false, id: id ?? null, reason: 'missing Svix headers' };
  const seconds = Number(timestamp);
  if (
    !Number.isFinite(seconds) ||
    Math.abs(now.getTime() - seconds * 1000) > SVIX_TOLERANCE_MS
  )
    return { ok: false, id, reason: 'timestamp outside tolerance' };

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.`)
    .update(body)
    .digest();
  const matches = signature.split(' ').some((part) => {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return matches
    ? { ok: true, id }
    : { ok: false, id, reason: 'bad signature' };
}

/** What a test or a sender computes: the header value for one secret. */
export function signSvix(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const mac = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
  return `v1,${mac}`;
}
