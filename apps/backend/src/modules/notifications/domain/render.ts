import type { NotificationChannel } from '@waypoint/shared';
import type { Message } from './catalog';

/** Channel limits (specs/notifications, AC-NTF-14). */
export const SMS_MAX = 160;
export const PUSH_TITLE_MAX = 40;
export const PUSH_BODY_MAX = 120;

/** The GSM 03.38 basic set: anything outside it makes an SMS UCS-2 and cuts it to 70 characters. */
const GSM7 =
  /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;

export const isGsm7 = (text: string): boolean => GSM7.test(text);

/** Typographic characters a template might carry, mapped onto the GSM set. */
const TO_GSM: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '…': '...',
  '·': '-',
  '→': '->',
  ' ': ' ',
};

const clamp = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

export type Rendered =
  | { channel: 'IN_APP'; title: string; body: string; link: string }
  | { channel: 'EMAIL'; subject: string; text: string }
  | { channel: 'SMS'; text: string }
  | { channel: 'PUSH'; title: string; body: string; link: string; tag: string };

/**
 * One catalog message shaped for one channel. SMS is GSM-7 only (no emoji)
 * and at most one 160-character segment; push has a short title and body, a
 * deep link and a tag per record, so a newer push about the same record
 * replaces the older one on the phone instead of stacking.
 */
export function render(
  channel: Exclude<NotificationChannel, 'WHATSAPP'>,
  message: Message,
  record: { eventType: string; entityId: string | null | undefined },
  appUrl = '',
): Rendered {
  switch (channel) {
    case 'IN_APP':
      return { channel, ...message };
    case 'EMAIL':
      return {
        channel,
        subject: message.title,
        text: `${message.body}\n\nOpen in Waypoint Compass: ${appUrl}${message.link}`,
      };
    case 'SMS': {
      const text = [...`Waypoint: ${message.body}`]
        .map((c) => TO_GSM[c] ?? c)
        .join('')
        .replace(/[^\n\r -~£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡¤ÄÖÑÜ§¿äöñüà€]/gu, '');
      return {
        channel,
        text:
          text.length <= SMS_MAX
            ? text
            : `${text.slice(0, SMS_MAX - 3).trimEnd()}...`,
      };
    }
    case 'PUSH':
      return {
        channel,
        title: clamp(message.title, PUSH_TITLE_MAX),
        body: clamp(message.body, PUSH_BODY_MAX),
        link: message.link,
        tag: `${record.eventType}:${record.entityId ?? 'none'}`,
      };
  }
}
