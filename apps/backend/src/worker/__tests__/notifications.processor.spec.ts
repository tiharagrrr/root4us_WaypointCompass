import type { Job } from 'bullmq';
import type { DemoInbox, DemoMessage } from '../../core/demo/demo-inbox';
import { AUTH_INVITE_JOB, AUTH_OTP_JOB } from '../../modules/identity';
import type { JobContextRunner } from '../../core/context/job-context';
import type { SmsMessage, SmsProvider } from '../../core/providers/ports';
import type { NotificationSender } from '../../modules/notifications';
import {
  NotificationsProcessor,
  notifyBackoff,
} from '../notifications.processor';

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

/** Whatever SMS_PROVIDER resolved to; the job must not care which it is. */
function gateway() {
  const sent: SmsMessage[] = [];
  const fake: SmsProvider = {
    name: 'notifylk',
    send: (message) => {
      sent.push(message);
      return Promise.resolve({
        provider: 'notifylk',
        providerMessageId: 'nlk-1',
      });
    },
    health: () => Promise.resolve(true),
  };
  return { fake, sent };
}

const processor = (fake: DemoInbox, sms: SmsProvider = gateway().fake) =>
  new NotificationsProcessor(
    fake,
    {} as NotificationSender,
    {} as JobContextRunner,
    sms,
  );

const otpJob = {
  id: '77',
  name: AUTH_OTP_JOB,
  timestamp: Date.parse('2026-10-01T03:00:00Z'),
  data: { v: 1, phoneNumber: '+94776041932', code: '482913' },
} as Job;

describe('NotificationsProcessor', () => {
  it('AC-NTF-16 a sign-in code takes the configured SMS gateway', async () => {
    const { fake, sent } = gateway();
    await processor(inbox(true).fake, fake).process(otpJob);
    expect(sent).toEqual([
      {
        to: '+94776041932',
        text: expect.stringContaining('482913') as string,
        idempotencyKey: 'otp-77',
      },
    ]);
  });

  it('AC-NTF-16 keys the code by the job, never by the code itself', async () => {
    const { fake, sent } = gateway();
    await processor(inbox(true).fake, fake).process(otpJob);
    expect(sent[0].idempotencyKey).not.toContain('482913');
  });

  it("lets the gateway's refusal reach BullMQ, so the job retries", async () => {
    const refusing: SmsProvider = {
      name: 'notifylk',
      send: () => Promise.reject(new Error('Notify.lk did not answer')),
      health: () => Promise.resolve(true),
    };
    await expect(
      processor(inbox(true).fake, refusing).process(otpJob),
    ).rejects.toThrow(/Notify.lk/);
  });

  it('sends an invitation by SMS through the gateway', async () => {
    const { fake, sent } = gateway();
    await processor(inbox(true).fake, fake).process(inviteJob('sms'));
    expect(sent).toEqual([
      {
        to: '+94771234567',
        text: "You're invited to Waypoint Compass. Open http://localhost:8080/invite/abc to set up your account before 3 Oct 10:00.",
        idempotencyKey: 'invite-0192a3f4-0000-7000-8000-000000000002',
      },
    ]);
  });

  it('puts an invitation email in the demo inbox, which is all email has here', async () => {
    const { fake, messages } = inbox(true);
    await processor(fake).process(inviteJob('email'));
    expect(messages).toEqual([
      {
        channel: 'email',
        to: 'kasun@example.test',
        body: expect.stringContaining(
          'http://localhost:8080/invite/abc',
        ) as string,
        sentAt: '2026-09-30T04:30:00.000Z',
      },
    ]);
  });

  it('fails an invitation email without demo mode, until email has an adapter', async () => {
    const { fake, messages } = inbox(false);
    await expect(processor(fake).process(inviteJob('email'))).rejects.toThrow(
      /email provider/,
    );
    expect(messages).toHaveLength(0);
  });

  it('AC-NTF-06 Retryable failures back off, then fail', () => {
    expect([1, 2, 3].map(notifyBackoff)).toEqual([30_000, 120_000, 600_000]);
  });
});

function inviteJob(channel: 'sms' | 'email'): Job {
  return {
    name: AUTH_INVITE_JOB,
    timestamp: Date.parse('2026-09-30T04:30:00Z'),
    data: {
      v: 1,
      invitationId: '0192a3f4-0000-7000-8000-000000000002',
      channel,
      to: channel === 'sms' ? '+94771234567' : 'kasun@example.test',
      name: 'Kasun Perera',
      link: 'http://localhost:8080/invite/abc',
      expiresAt: '2026-10-03T10:00:00+05:30',
    },
  } as Job;
}
