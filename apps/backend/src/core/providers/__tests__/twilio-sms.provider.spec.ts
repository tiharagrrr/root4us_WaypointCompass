import { TwilioSmsProvider } from '../twilio-sms.provider';
import {
  describeSmsProvider,
  formOf,
  gateway,
  MESSAGE,
} from './sms-provider.contract';

/**
 * Twilio against a mocked API: basic auth, form-encoded, E.164 with the plus,
 * and the one gateway here that honours an idempotency key.
 */
const OPTIONS = {
  accountSid: 'AC00000000000000000000000000000001',
  authToken: 'test-token',
  from: '+15005550006',
};

const ACCEPTED = { sid: 'SM0000000001', status: 'queued' };

describeSmsProvider({
  name: 'twilio',
  build: (http) => new TwilioSmsProvider(OPTIONS, http),
  keyless: (http) => new TwilioSmsProvider({}, http),
  accepted: ACCEPTED,
});

describe('TwilioSmsProvider', () => {
  it('posts to the account messages endpoint with basic auth', async () => {
    const { http, calls } = gateway(ACCEPTED);
    const sent = await new TwilioSmsProvider(OPTIONS, http).send(MESSAGE);

    expect(calls[0].url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${OPTIONS.accountSid}/Messages.json`,
    );
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from(`${OPTIONS.accountSid}:${OPTIONS.authToken}`).toString('base64')}`,
    );
    expect(Object.fromEntries(formOf(calls[0].init))).toEqual({
      To: '+94776041932',
      From: '+15005550006',
      Body: MESSAGE.text,
    });
    expect(sent).toEqual({
      provider: 'twilio',
      providerMessageId: 'SM0000000001',
    });
  });

  it('passes the idempotency key, so a retried job sends once', async () => {
    const { http, calls } = gateway(ACCEPTED);
    await new TwilioSmsProvider(OPTIONS, http).send(MESSAGE);
    expect(
      (calls[0].init.headers as Record<string, string>)['Idempotency-Key'],
    ).toBe(MESSAGE.idempotencyKey);
  });

  it('routes through a messaging service when TWILIO_FROM is an MG sid', async () => {
    const { http, calls } = gateway(ACCEPTED);
    await new TwilioSmsProvider(
      { ...OPTIONS, from: 'MG00000000000000000000000000000001' },
      http,
    ).send(MESSAGE);
    const form = formOf(calls[0].init);
    expect(form.get('MessagingServiceSid')).toBe(
      'MG00000000000000000000000000000001',
    );
    expect(form.get('From')).toBeNull();
  });

  it('keeps a foreign number as typed, instead of assuming +94', async () => {
    const { http, calls } = gateway(ACCEPTED);
    await new TwilioSmsProvider(OPTIONS, http).send({
      ...MESSAGE,
      to: '+6591234567',
    });
    expect(formOf(calls[0].init).get('To')).toBe('+6591234567');
  });

  it('treats a failed message in a 201 body as a permanent refusal', async () => {
    const { http } = gateway({
      sid: 'SM1',
      status: 'failed',
      error_code: 21211,
      error_message: 'Invalid To phone number',
    });
    await expect(
      new TwilioSmsProvider(OPTIONS, http).send(MESSAGE),
    ).rejects.toMatchObject({ retryable: false, providerCode: '21211' });
  });
});
