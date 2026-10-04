import type { NotificationChannel } from '@waypoint/shared';
import { type Audience, CATALOG } from './catalog';
import { FIXTURES } from './fixtures';
import { type Rendered, render } from './render';

/** Copy exists in English only so far (Sinhala and Tamil are ROO-66); other locales fall back. */
export const LOCALES_WITH_COPY = ['en'] as const;

export interface Preview {
  eventType: string;
  channel: NotificationChannel;
  requestedLocale: string;
  /** The locale the copy is actually in. */
  locale: string;
  audiences: { to: Audience; rendered: Rendered }[];
}

/**
 * What GET /dev/notifications/preview/{event} shows: every audience's message
 * for the event's fixture, shaped for one channel. Null for an event the
 * catalog does not know.
 */
export function preview(
  eventType: string,
  channel: Exclude<NotificationChannel, 'WHATSAPP'>,
  requestedLocale = 'en',
  appUrl = '',
): Preview | null {
  const entries = CATALOG[eventType];
  const fixture = FIXTURES[eventType];
  if (!entries || !fixture) return null;
  const locale = (LOCALES_WITH_COPY as readonly string[]).includes(
    requestedLocale,
  )
    ? requestedLocale
    : 'en';
  return {
    eventType,
    channel,
    requestedLocale,
    locale,
    audiences: entries.flatMap((entry) => {
      const message = entry.message(fixture.payload, fixture.facts);
      return message
        ? [
            {
              to: entry.to,
              rendered: render(
                channel,
                message,
                { eventType, entityId: fixture.entityId },
                appUrl,
              ),
            },
          ]
        : [];
    }),
  };
}
