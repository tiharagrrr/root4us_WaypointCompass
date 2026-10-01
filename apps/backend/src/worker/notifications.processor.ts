import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { DemoInbox, type DemoMessage } from '../core/demo/demo-inbox';
import {
  AUTH_INVITE_JOB,
  AUTH_OTP_JOB,
  type AuthInviteJob,
  type AuthOtpJob,
} from '../modules/identity';
import { QUEUES } from '../queues';

/**
 * Sends what the API queues on the notifications queue: driver sign-in codes
 * and invitation links. In demo mode they land in the demo inbox. The SMS
 * and email providers, and every other notification, arrive with the
 * notifications module (Step 7).
 */
@Processor(QUEUES.notifications)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly inbox: DemoInbox) {
    super();
  }

  async process(job: Job<unknown>): Promise<void> {
    const sentAt = new Date(job.timestamp).toISOString();
    switch (job.name) {
      case AUTH_OTP_JOB: {
        const { phoneNumber, code } = job.data as AuthOtpJob;
        return this.deliver({
          channel: 'sms',
          to: phoneNumber,
          body: `Your Waypoint Compass sign-in code is ${code}. It expires in 5 minutes.`,
          sentAt,
        });
      }
      case AUTH_INVITE_JOB: {
        const invite = job.data as AuthInviteJob;
        return this.deliver({
          channel: invite.channel,
          to: invite.to,
          body: inviteText(invite),
          sentAt,
        });
      }
      default:
        this.logger.warn({ event: 'notifications.job.skipped', job: job.name });
    }
  }

  private async deliver(message: Omit<DemoMessage, 'id'>): Promise<void> {
    if (!this.inbox.enabled) {
      const provider = message.channel === 'sms' ? 'SMS' : 'email';
      throw new Error(
        `No ${provider} provider yet: set DEMO_MODE=true to use the demo inbox`,
      );
    }
    await this.inbox.push(message);
  }
}

/** "2026-10-03T10:00:00+05:30" reads as "3 Oct 10:00". */
function expiry(iso: string): string {
  const [date, time] = iso.split('T');
  const [, month, day] = date.split('-');
  const months = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
  return `${Number(day)} ${months[Number(month) - 1]} ${time.slice(0, 5)}`;
}

function inviteText(invite: AuthInviteJob): string {
  const until = expiry(invite.expiresAt);
  return invite.channel === 'sms'
    ? `You're invited to Waypoint Compass. Open ${invite.link} to set up your account before ${until}.`
    : `Hi ${invite.name}, you're invited to Waypoint Compass. Open ${invite.link} to set up your account. The link works until ${until}.`;
}
