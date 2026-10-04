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

const SEND_URL = 'https://app.text.lk/api/v3/sms/send';

export interface TextLkOptions {
  apiToken?: string;
  /** The registered mask; Text.lk falls back to its own when none is given. */
  senderId?: string;
}

/**
 * SMS_PROVIDER=textlk: Text.lk, the second Sri Lankan gateway, kept so the
 * route can be switched with one variable when one operator's delivery goes
 * bad on demo day. A bearer token, JSON in and out, numbers as bare digits.
 *
 * Like Notify.lk it answers 200 with `{"status":"error"}` for a refusal, so
 * the body decides. It has no idempotency key either.
 */
export class TextLkSmsProvider implements SmsProvider {
  readonly name = 'textlk';

  constructor(
    private readonly options: TextLkOptions,
    private readonly http: typeof fetch = globalThis.fetch,
  ) {}

  async send(message: SmsMessage): Promise<SendResult> {
    const { apiToken, senderId } = this.options;
    if (!apiToken)
      throw new ProviderError(
        'SMS_PROVIDER=textlk needs TEXTLK_API_TOKEN',
        false,
      );

    const body = await postToGateway(this.http, 'Text.lk', SEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        recipient: this.recipient(message.to),
        sender_id: message.senderId ?? senderId,
        type: 'plain',
        message: message.text,
      }),
    });
    return {
      provider: this.name,
      providerMessageId: this.read(body, message),
    };
  }

  health(): Promise<boolean> {
    return Promise.resolve(Boolean(this.options.apiToken));
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
      throw new ProviderError('Text.lk sent an unexpected body', false);
    if (parsed.data.status !== 'success')
      throw new ProviderError(
        `Text.lk refused ${maskPhone(message.to)}: ${parsed.data.message ?? parsed.data.status}`,
        false,
        parsed.data.status,
      );
    return (
      parsed.data.data?.uid ?? message.idempotencyKey ?? `textlk-${Date.now()}`
    );
  }
}

const reply = z.object({
  status: z.string(),
  message: z.string().nullish(),
  data: z.object({ uid: z.coerce.string().nullish() }).nullish(),
});
