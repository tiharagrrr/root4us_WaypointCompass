import { z } from 'zod';
import {
  InvalidPhoneNumber,
  maskPhone,
  toLocalDigits,
} from '../phone/sri-lanka-phone';
import {
  ProviderError,
  type SendResult,
  type SmsMessage,
  type SmsProvider,
} from './ports';
import { postToGateway } from './sms-http';

const SEND_URL = 'https://app.notify.lk/api/v1/send';

export interface NotifyLkOptions {
  userId?: string;
  apiKey?: string;
  /** The mask the recipient sees; Notify.lk only allows ones it has registered. */
  senderId?: string;
}

/**
 * SMS_PROVIDER=notifylk: Notify.lk, a Sri Lankan gateway on the local
 * operators' routes, so a +94 number costs a fraction of an international
 * send and a registered sender id (WayPoint) shows instead of a short code.
 *
 * The API takes form-encoded credentials rather than a header, wants the
 * number as bare digits (94771234932), and answers 200 with
 * `{"status":"error"}` for a refusal, so the body decides the outcome, not
 * the status code. It has no idempotency key: BullMQ's `attempts` is what
 * keeps a retry from doubling up, which is why a non-retryable refusal must
 * stay non-retryable here.
 */
export class NotifyLkSmsProvider implements SmsProvider {
  readonly name = 'notifylk';

  constructor(
    private readonly options: NotifyLkOptions,
    private readonly http: typeof fetch = globalThis.fetch,
  ) {}

  async send(message: SmsMessage): Promise<SendResult> {
    const { userId, apiKey, senderId } = this.options;
    if (!userId || !apiKey)
      throw new ProviderError(
        'SMS_PROVIDER=notifylk needs NOTIFYLK_USER_ID and NOTIFYLK_API_KEY',
        false,
      );

    const body = await postToGateway(this.http, 'Notify.lk', SEND_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        user_id: userId,
        api_key: apiKey,
        sender_id: message.senderId ?? senderId ?? 'NotifyDEMO',
        to: this.recipient(message.to),
        message: message.text,
      }).toString(),
    });
    return {
      provider: this.name,
      providerMessageId: this.read(body, message),
    };
  }

  /** A user id and a key are all this adapter needs; it sends nothing to check. */
  health(): Promise<boolean> {
    return Promise.resolve(Boolean(this.options.userId && this.options.apiKey));
  }

  private recipient(to: string): string {
    try {
      return toLocalDigits(to);
    } catch (error: unknown) {
      if (error instanceof InvalidPhoneNumber)
        throw new ProviderError(error.message, false, 'invalid_number');
      throw error;
    }
  }

  private read(body: unknown, message: SmsMessage): string {
    const parsed = reply.safeParse(body);
    if (!parsed.success)
      throw new ProviderError('Notify.lk sent an unexpected body', false);
    if (parsed.data.status !== 'success')
      // A bad number, an unregistered sender id or no credit: sending again
      // changes nothing until someone fixes the account.
      throw new ProviderError(
        `Notify.lk refused ${maskPhone(message.to)}: ${parsed.data.message ?? parsed.data.status}`,
        false,
        parsed.data.status,
      );
    return (
      parsed.data.data?.message_id ??
      message.idempotencyKey ??
      `notifylk-${Date.now()}`
    );
  }
}

/** Only the fields this adapter reads; the id comes back as a number on some sends. */
const reply = z.object({
  status: z.string(),
  message: z.string().nullish(),
  data: z
    .object({
      message_id: z.coerce.string().nullish(),
    })
    .nullish(),
});
