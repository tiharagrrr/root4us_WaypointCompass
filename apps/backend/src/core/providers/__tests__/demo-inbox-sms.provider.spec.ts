import type { ClockService } from '../../clock/clock.service';
import type { DemoInbox, DemoMessage } from '../../demo/demo-inbox';
import { DemoInboxSmsProvider } from '../demo-inbox-sms.provider';
import { MESSAGE } from './sms-provider.contract';

function inbox(enabled: boolean) {
  const messages: Omit<DemoMessage, 'id'>[] = [];
  const fake = {
    enabled,
    push: (m: Omit<DemoMessage, 'id'>) => {
      messages.push(m);
      return Promise.resolve();
    },
  };
  return { fake: fake as unknown as DemoInbox, messages };
}

const clock = {
  now: () => new Date('2026-10-04T04:30:00Z'),
  toIso: () => '2026-10-04T10:00:00+05:30',
} as unknown as ClockService;

/**
 * The keyless default. It is the one adapter with no HTTP at all, so what
 * matters is that demo mode decides whether it can accept anything, and that
 * it normalises the number like the real gateways do - a demo that passes on
 * a number production would refuse is worse than no demo.
 */
describe('DemoInboxSmsProvider', () => {
  it('puts the message in the demo inbox in E.164', async () => {
    const { fake, messages } = inbox(true);
    const sent = await new DemoInboxSmsProvider(fake, clock).send({
      ...MESSAGE,
      to: '0776041932',
    });

    expect(sent.provider).toBe('demo-inbox');
    expect(sent.providerMessageId).toMatch(/^demo-/);
    expect(messages).toEqual([
      {
        channel: 'sms',
        to: '+94776041932',
        body: MESSAGE.text,
        sentAt: '2026-10-04T10:00:00+05:30',
      },
    ]);
  });

  it('fails permanently without demo mode, naming the way out', async () => {
    const { fake, messages } = inbox(false);
    await expect(
      new DemoInboxSmsProvider(fake, clock).send(MESSAGE),
    ).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining('SMS_PROVIDER=notifylk') as string,
    });
    expect(messages).toHaveLength(0);
  });

  it('refuses a number the real gateways would refuse', async () => {
    const { fake, messages } = inbox(true);
    await expect(
      new DemoInboxSmsProvider(fake, clock).send({ ...MESSAGE, to: '12345' }),
    ).rejects.toMatchObject({
      retryable: false,
      providerCode: 'invalid_number',
    });
    expect(messages).toHaveLength(0);
  });

  it('is healthy only in demo mode', async () => {
    await expect(
      new DemoInboxSmsProvider(inbox(true).fake, clock).health(),
    ).resolves.toBe(true);
    await expect(
      new DemoInboxSmsProvider(inbox(false).fake, clock).health(),
    ).resolves.toBe(false);
  });
});
