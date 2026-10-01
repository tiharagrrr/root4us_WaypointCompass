import type { Job } from 'bullmq';
import type { DemoInbox, DemoMessage } from '../../core/demo/demo-inbox';
import { AUTH_INVITE_JOB, AUTH_OTP_JOB } from '../../modules/identity';
import { NotificationsProcessor } from '../notifications.processor';

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

const otpJob = {
  name: AUTH_OTP_JOB,
  timestamp: Date.parse('2026-10-01T03:00:00Z'),
  data: { v: 1, phoneNumber: '+94776041932', code: '482913' },
} as Job;

describe('NotificationsProcessor', () => {
  it('puts a driver sign-in code in the demo inbox in demo mode', async () => {
    const { fake, messages } = inbox(true);
    await new NotificationsProcessor(fake).process(otpJob);
    expect(messages).toEqual([
      {
        channel: 'sms',
        to: '+94776041932',
        body: expect.stringContaining('482913') as string,
        sentAt: '2026-10-01T03:00:00.000Z',
      },
    ]);
  });

  it('fails the job without demo mode until an SMS provider exists', async () => {
    const { fake, messages } = inbox(false);
    await expect(
      new NotificationsProcessor(fake).process(otpJob),
    ).rejects.toThrow(/SMS provider/);
    expect(messages).toHaveLength(0);
  });

  it('puts an invitation link in the demo inbox by its channel', async () => {
    const { fake, messages } = inbox(true);
    await new NotificationsProcessor(fake).process({
      name: AUTH_INVITE_JOB,
      timestamp: Date.parse('2026-09-30T04:30:00Z'),
      data: {
        v: 1,
        invitationId: '0192a3f4-0000-7000-8000-000000000002',
        channel: 'sms',
        to: '+94771234567',
        name: 'Kasun Perera',
        link: 'http://localhost:8080/invite/abc',
        expiresAt: '2026-10-03T10:00:00+05:30',
      },
    } as Job);
    expect(messages).toEqual([
      {
        channel: 'sms',
        to: '+94771234567',
        body: "You're invited to Waypoint Compass. Open http://localhost:8080/invite/abc to set up your account before 3 Oct 10:00.",
        sentAt: '2026-09-30T04:30:00.000Z',
      },
    ]);
  });
});
