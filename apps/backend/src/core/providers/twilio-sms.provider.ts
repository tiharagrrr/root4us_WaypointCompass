import { z } from 'zod';
import { InvalidPhoneNumber, toE164 } from '../phone/sri-lanka-phone';
import {
  ProviderError,
  type SendResult,
  type SmsMessage,
  type SmsProvider,
} from './ports';
import { postToGateway } from './sms-http';

const API = 'https://api.twilio.com/2010-04-01';

export interface TwilioOptions {
  accountSid?: string;
  authToken?: string;
  /** A Twilio number, or a messaging service SID (MG...) that holds the pool. */
  from?: string;
}

/**
 * SMS_PROVIDER=twilio: the way out when a number is not Sri Lankan, or when
 * neither local gateway will take an alphanumeric sender. It costs more per
 * message than Notify.lk or Text.lk on a +94 number, so it is the fallback,
 * not the default.
 *
 * Basic auth, form-encoded, and the only adapter with a real idempotency
 * guarantee: Twilio keys a send by the body's `Idempotency-Key` header, so a
 * retried job sends once.
 */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';

  constructor(
    private readonly options: TwilioOptions,
    private readonly http: typeof fetch = globalThis.fetch,
  ) {}

  async send(message: SmsMessage): Promise<SendResult> {
    const { accountSid, authToken, from } = this.options;
    if (!accountSid || !authToken || !from)
      throw new ProviderError(
        'SMS_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM',
        false,
      );

    const form = new URLSearchParams({
      To: this.recipient(message.to),
      Body: message.text,
    });
    // A messaging service routes across a pool of numbers; a bare number does not.
    form.set(from.startsWith('MG') ? 'MessagingServiceSid' : 'From', from);

    const body = await postToGateway(
      this.http,
      'Twilio',
      `${API}/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
          ...(message.idempotencyKey && {
            'Idempotency-Key': message.idempotencyKey,
          }),
        },
        body: form.toString(),
      },
    );
    return {
      provider: this.name,
      providerMessageId: this.read(body, message),
    };
  }

  health(): Promise<boolean> {
    const { accountSid, authToken, from } = this.options;
    return Promise.resolve(Boolean(accountSid && authToken && from));
  }

  private recipient(to: string): string {
    try {
      return toE164(to);
    } catch (error: unknown) {
      if (error instanceof InvalidPhoneNumber)
        throw new ProviderError(error.message, false, 'invalid_number');
      throw error;
    }
  }

  private read(body: unknown, message: SmsMessage): string {
    const parsed = reply.safeParse(body);
    if (!parsed.success)
      throw new ProviderError('Twilio sent an unexpected body', false);
    // Twilio reports some refusals in the body of a 201 (status "failed").
    if (parsed.data.status === 'failed' || parsed.data.error_code)
      throw new ProviderError(
        `Twilio refused the message: ${parsed.data.error_message ?? parsed.data.error_code ?? 'failed'}`,
        false,
        parsed.data.error_code ?? undefined,
      );
    return parsed.data.sid ?? message.idempotencyKey ?? `twilio-${Date.now()}`;
  }
}

const reply = z.object({
  sid: z.string().nullish(),
  status: z.string().nullish(),
  error_code: z.coerce.string().nullish(),
  error_message: z.string().nullish(),
});
