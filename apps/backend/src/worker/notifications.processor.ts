import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job, UnrecoverableError } from 'bullmq';
import { JobContextRunner } from '../core/context/job-context';
import { DemoInbox, type DemoMessage } from '../core/demo/demo-inbox';
import {
  AUTH_INVITE_JOB,
  AUTH_OTP_JOB,
  type AuthInviteJob,
  type AuthOtpJob,
} from '../modules/identity';
import {
  NOTIFY_SEND_JOB,
  NotificationSender,
  SEND_ATTEMPTS,
  SEND_BACKOFF_MS,
  type SendJob,
} from '../modules/notifications';
import { QUEUES } from '../queues';

/** 30 s, 2 min, 10 min between notify.send attempts (AC-NTF-06). */
export const notifyBackoff = (attemptsMade: number): number =>
  SEND_BACKOFF_MS[Math.min(attemptsMade, SEND_BACKOFF_MS.length) - 1] ??
  SEND_BACKOFF_MS[0];

/**
 * Sends what the API queues on the notifications queue: driver sign-in codes
 * and invitation links (security messages, outside the catalog), and the
 * notifications module's EMAIL, SMS and PUSH rows (notify.send). In demo
 * mode SMS and email land in the demo inbox.
 */
@Processor(QUEUES.notifications, {
  settings: { backoffStrategy: notifyBackoff },
})
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly inbox: DemoInbox,
    private readonly sender: NotificationSender,
    private readonly jobs: JobContextRunner,
  ) {
    super();
  }

  async process(job: Job<unknown>): Promise<void> {
    if (job.name === NOTIFY_SEND_JOB) return this.send(job as Job<SendJob>);
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

  /** One notification row; a failure the provider may recover from is thrown so BullMQ backs off. */
  private async send(job: Job<SendJob>): Promise<void> {
    const attempt = job.attemptsMade + 1;
    const outcome = await this.jobs.runInJobContext(
      job,
      () =>
        this.sender.send(
          job.data.notificationId,
          attempt,
          job.opts.attempts ?? SEND_ATTEMPTS,
        ),
      // The sender opens its own transaction, so its failure record commits.
      { transaction: false },
    );
    if (outcome === 'retry')
      throw new Error(`notify.send attempt ${attempt} failed; retrying`);
    if (outcome === 'failed')
      throw new UnrecoverableError('notify.send failed for good');
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
