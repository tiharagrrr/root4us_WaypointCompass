import { NotifyLkSmsProvider } from '../notifylk-sms.provider';
import {
  describeSmsProvider,
  formOf,
  gateway,
  MESSAGE,
} from './sms-provider.contract';

/**
 * Notify.lk against a mocked gateway; it never reaches the internet. What
 * matters is the shape it insists on - form-encoded credentials, the number
 * as bare local digits - and that a refusal it reports in a 200 body is a
 * non-retryable ProviderError, not a success.
 */
const OPTIONS = {
  userId: '12345',
  apiKey: 'test-key',
  senderId: 'WayPoint',
};

const ACCEPTED = {
  status: 'success',
  data: { user_id: 12345, message_id: 982341 },
};

describeSmsProvider({
  name: 'notifylk',
  build: (http) => new NotifyLkSmsProvider(OPTIONS, http),
  keyless: (http) => new NotifyLkSmsProvider({}, http),
  accepted: ACCEPTED,
});

describe('NotifyLkSmsProvider', () => {
  it('posts the credentials, the sender id and bare local digits', async () => {
    const { http, calls } = gateway(ACCEPTED);
    await new NotifyLkSmsProvider(OPTIONS, http).send(MESSAGE);

    expect(calls[0].url).toBe('https://app.notify.lk/api/v1/send');
    const form = formOf(calls[0].init);
    expect(Object.fromEntries(form)).toEqual({
      user_id: '12345',
      api_key: 'test-key',
      sender_id: 'WayPoint',
      to: '94776041932',
      message: MESSAGE.text,
    });
  });

  it.each([
    ['0776041932', '94776041932'],
    ['+94 77 604 1932', '94776041932'],
    ['94776041932', '94776041932'],
    ['776041932', '94776041932'],
  ])('sends %s as %s', async (typed, expected) => {
    const { http, calls } = gateway(ACCEPTED);
    await new NotifyLkSmsProvider(OPTIONS, http).send({
      ...MESSAGE,
      to: typed,
    });
    expect(formOf(calls[0].init).get('to')).toBe(expected);
  });

  it('reads the message id a receipt will name the row by', async () => {
    const { http } = gateway(ACCEPTED);
    const sent = await new NotifyLkSmsProvider(OPTIONS, http).send(MESSAGE);
    expect(sent).toEqual({
      provider: 'notifylk',
      providerMessageId: '982341',
    });
  });

  it('AC-NTF-17 treats status "error" in a 200 as a permanent refusal', async () => {
    const { http } = gateway({
      status: 'error',
      message: 'Insufficient balance',
    });
    await expect(
      new NotifyLkSmsProvider(OPTIONS, http).send(MESSAGE),
    ).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining('Insufficient balance') as string,
    });
  });

  it('masks the number in a refusal, so no log carries it in full', async () => {
    const { http } = gateway({ status: 'error', message: 'Invalid number' });
    await expect(
      new NotifyLkSmsProvider(OPTIONS, http).send(MESSAGE),
    ).rejects.toMatchObject({
      message: expect.stringContaining('+94 77 ••• 1932') as string,
    });
  });

  it('falls back to the demo sender id when none is registered yet', async () => {
    const { http, calls } = gateway(ACCEPTED);
    await new NotifyLkSmsProvider({ userId: '1', apiKey: 'k' }, http).send(
      MESSAGE,
    );
    expect(formOf(calls[0].init).get('sender_id')).toBe('NotifyDEMO');
  });

  it('sends a body that is not JSON to a permanent failure', async () => {
    const { http } = gateway('<html>maintenance</html>');
    await expect(
      new NotifyLkSmsProvider(OPTIONS, http).send(MESSAGE),
    ).rejects.toMatchObject({ retryable: false });
  });
});
