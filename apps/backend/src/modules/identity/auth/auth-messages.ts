import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUES } from '../../../queues';
import { maskPhone } from '../domain/mask-phone';

export const AUTH_OTP_JOB = 'auth.otp';

export interface AuthOtpJob {
  v: 1;
  phoneNumber: string;
  code: string;
}

/**
 * Messages BetterAuth asks us to send. The API only queues them; the worker
 * sends them (the SMS provider, or the demo inbox when DEMO_MODE=true), so a
 * slow provider never holds up a sign-in request.
 */
@Injectable()
export class AuthMessages {
  private readonly log = new Logger(AuthMessages.name);

  constructor(
    @InjectQueue(QUEUES.notifications) private readonly queue: Queue,
  ) {}

  async enqueueOtp(phoneNumber: string, code: string): Promise<void> {
    const job: AuthOtpJob = { v: 1, phoneNumber, code };
    await this.queue.add(AUTH_OTP_JOB, job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
    this.log.log(
      { event: 'auth.otp.sent', phone: maskPhone(phoneNumber) },
      'sign-in code queued',
    );
  }
}
