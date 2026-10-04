/**
 * The ping pipeline's rules (specs/execution/spec.md, Ping pipeline), pure so
 * they are tested without a database.
 */

/** At most this many pings in one POST /telematics/pings. */
export const MAX_PINGS = 200;
/** Worse than this and the fix is noise. */
export const MAX_ACCURACY_M = 200;
/** A phone clock may run this far ahead. */
export const MAX_AHEAD_MS = 2 * 60 * 1000;
/** Older pings are history nobody will look at live. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** The trail keeps a ping when this long or this far has passed since the last one kept. */
export const KEEP_EVERY_MS = 30 * 1000;
export const KEEP_EVERY_M = 100;
/** vehicle.position reaches the screens at most once per vehicle this often. */
export const PUBLISH_EVERY_MS = 5 * 1000;
/** 19 shows "no signal since" after this many minutes; vehicle.offline comes at the setting (30). */
export const NO_SIGNAL_MINUTES = 10;

/** Sri Lanka, with a margin for the coast. */
export const SRI_LANKA = {
  minLat: 5.85,
  maxLat: 9.9,
  minLng: 79.5,
  maxLng: 81.95,
};

export interface PingFix {
  lat: number;
  lng: number;
  accuracyM?: number | null;
  recordedAt: Date;
}

export type RejectReason =
  | 'outside_sri_lanka'
  | 'inaccurate'
  | 'from_the_future'
  | 'too_old'
  | 'not_your_running_trip';

/** Why a fix is refused, or null when it is fine. The trip check is the caller's. */
export function rejectReason(fix: PingFix, now: Date): RejectReason | null {
  const { minLat, maxLat, minLng, maxLng } = SRI_LANKA;
  if (
    !Number.isFinite(fix.lat) ||
    !Number.isFinite(fix.lng) ||
    fix.lat < minLat ||
    fix.lat > maxLat ||
    fix.lng < minLng ||
    fix.lng > maxLng
  )
    return 'outside_sri_lanka';
  if (fix.accuracyM != null && fix.accuracyM > MAX_ACCURACY_M)
    return 'inaccurate';
  const at = fix.recordedAt.getTime();
  if (at > now.getTime() + MAX_AHEAD_MS) return 'from_the_future';
  if (at < now.getTime() - MAX_AGE_MS) return 'too_old';
  return null;
}

/** Great-circle distance in metres. */
export function metresBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Whether the trail keeps this fix, given the last one it kept. The trail only
 * moves forward: a fix older than the last kept one arrived late and is not
 * written into the middle of it.
 */
export function keepInTrail(last: PingFix | null, fix: PingFix): boolean {
  if (!last) return true;
  if (fix.recordedAt.getTime() <= last.recordedAt.getTime()) return false;
  return (
    fix.recordedAt.getTime() - last.recordedAt.getTime() >= KEEP_EVERY_MS ||
    metresBetween(last, fix) >= KEEP_EVERY_M
  );
}
