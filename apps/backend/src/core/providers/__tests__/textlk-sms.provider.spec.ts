import { TextLkSmsProvider } from '../textlk-sms.provider';
import {
  describeSmsProvider,
  gateway,
  jsonOf,
  MESSAGE,
} from './sms-provider.contract';

/** Text.lk against a mocked gateway: a bearer token, JSON, bare local digits. */
const OPTIONS = { apiToken: 'test-token', senderId: 'WayPoint' };

const ACCEPTED = { status: 'success', data: { uid: 'abc-123' } };

describeSmsProvider({
  name: 'textlk',
  build: (http) => new TextLkSmsProvider(OPTIONS, http),
  keyless: (http) => new TextLkSmsProvider({}, http),
  accepted: ACCEPTED,
});

describe('TextLkSmsProvider', () => {
  it('posts the message as JSON with the token in the header', async () => {
    const { http, calls } = gateway(ACCEPTED);
    const sent = await new TextLkSmsProvider(OPTIONS, http).send(MESSAGE);

    expect(calls[0].url).toBe('https://app.text.lk/api/v3/sms/send');
    expect(
      (calls[0].init.headers as Record<string, string>).authorization,
    ).toBe('Bearer test-token');
    expect(jsonOf(calls[0].init)).toEqual({
      recipient: '94776041932',
      sender_id: 'WayPoint',
      type: 'plain',
      message: MESSAGE.text,
    });
    expect(sent).toEqual({ provider: 'textlk', providerMessageId: 'abc-123' });
  });

  it('treats status "error" in a 200 as a permanent refusal', async () => {
    const { http } = gateway({ status: 'error', message: 'No credit' });
    await expect(
      new TextLkSmsProvider(OPTIONS, http).send(MESSAGE),
    ).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining('No credit') as string,
    });
  });

  it('lets a caller override the sender id per message', async () => {
    const { http, calls } = gateway(ACCEPTED);
    await new TextLkSmsProvider(OPTIONS, http).send({
      ...MESSAGE,
      senderId: 'WPAlerts',
    });
    expect(jsonOf(calls[0].init).sender_id).toBe('WPAlerts');
  });
});
