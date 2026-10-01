import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { DemoInbox } from '../core/demo/demo-inbox';
import { AUTH_OTP_JOB, type AuthOtpJob } from '../modules/identity';
import { QUEUES } from '../queues';

/**
 * Sends what the API queues on the notifications queue. For now that is the
 * driver sign-in code: in demo mode it lands in the demo inbox. The SMS and
 * email providers, and every other notification, arrive with the
 * notifications module (Step 7).
 */
@Processor(QUEUES.notifications)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly inbox: DemoInbox) {
    super();
  }

  async process(job: Job<unknown>): Promise<void> {
    if (job.name !== AUTH_OTP_JOB) {
      this.logger.warn({ event: 'notifications.job.skipped', job: job.name });
      return;
    }
    const { phoneNumber, code } = job.data as AuthOtpJob;
    if (!this.inbox.enabled) {
      throw new Error(
        'No SMS provider yet: set DEMO_MODE=true to use the demo inbox',
      );
    }
    await this.inbox.push({
      channel: 'sms',
      to: phoneNumber,
      body: `Your Waypoint Compass sign-in code is ${code}. It expires in 5 minutes.`,
      sentAt: new Date(job.timestamp).toISOString(),
    });
  }
}
