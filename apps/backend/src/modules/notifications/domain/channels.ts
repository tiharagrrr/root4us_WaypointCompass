import type { NotificationChannel } from '@waypoint/shared';

/** What a person can receive on, looked up per recipient. */
export interface Reachability {
  /** A real address: drivers carry a placeholder (`…@drivers.waypoint.local`). */
  email: string | null;
  /** A verified phone in E.164. */
  phone: string | null;
  /** A device with a Web Push subscription. */
  push: boolean;
}

/** Addresses the system made up so every account has one; nothing is ever sent there. */
const PLACEHOLDER = /\.waypoint\.local$/i;

export const realEmail = (email: string | null | undefined) =>
  email && !PLACEHOLDER.test(email) ? email : null;

/**
 * The channels one person gets for one catalog entry (specs/notifications,
 * Pipeline): the entry's defaults, minus what their preference row leaves
 * out, minus what they can't receive. In-app is the record of every
 * notification, so it is always there (AC-NTF-03, AC-NTF-04); a security
 * message ignores preferences but still needs somewhere to go (AC-NTF-05).
 */
export function channelsFor(
  defaults: readonly NotificationChannel[],
  reach: Reachability,
  preference: readonly NotificationChannel[] | null,
  security = false,
): NotificationChannel[] {
  const wanted = new Set<NotificationChannel>(
    security || !preference
      ? defaults
      : defaults.filter((c) => preference.includes(c)),
  );
  if (!security) wanted.add('IN_APP');
  const can: Record<NotificationChannel, boolean> = {
    IN_APP: true,
    EMAIL: realEmail(reach.email) != null,
    SMS: reach.phone != null,
    PUSH: reach.push,
    WHATSAPP: false,
  };
  const order: NotificationChannel[] = ['IN_APP', 'EMAIL', 'SMS', 'PUSH'];
  return order.filter((c) => wanted.has(c) && can[c]);
}

/** One row per event, person and channel (AC-NTF-01). */
export const dedupeKeyOf = (
  eventId: string,
  userId: string,
  channel: NotificationChannel,
) => `${eventId}:${userId}:${channel}`;
