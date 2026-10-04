import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { eq, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { uuidv7 } from 'uuidv7';
import { ClockService } from '../../../core/clock/clock.service';
import { DemoInbox } from '../../../core/demo/demo-inbox';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { notifications, users } from '../../../db/schema';
import { realEmail } from '../domain/channels';
import { NOTIFICATION_LOGS } from '../notifications.constants';

/** A provider's refusal; `retryable` says whether trying again could help (AC-NTF-06, 07). */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Where a message goes out. Real providers (Resend, Twilio, Notify.lk, Web Push) plug in here. */
export interface Delivery {
  channel: 'EMAIL' | 'SMS';
  to: string;
  subject: string;
  text: string;
}

/** `retry`: the row is still QUEUED and the job should throw so BullMQ backs off. */
export type SendOutcome =
  'sent' | 'suppressed' | 'skipped' | 'failed' | 'retry';

/**
 * Sends one EMAIL, SMS or PUSH row from the worker's notify.send job and
 * records what happened on it. With DEMO_MODE=true email and SMS land in the
 * demo inbox (AC-NTF-15); with no provider configured a send fails at once
 * with the reason rather than retrying something that can never work. Push
 * has no provider yet, so its rows are SUPPRESSED, not failed.
 */
@Injectable()
export class NotificationSender {
  /** Swapped in tests to make the provider fail. */
  deliver: (delivery: Delivery) => Promise<string> = (d) => this.toInbox(d);

  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly inbox: DemoInbox,
    private readonly clock: ClockService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(NotificationSender.name);
  }

  /**
   * `attempt` counts from 1; on the last one a retryable failure is final.
   * Never throws for a provider failure: the row's attempt and error must
   * commit, so it answers `retry` and the job does the throwing.
   */
  @Transactional()
  async send(
    notificationId: string,
    attempt: number,
    lastAttempt: number,
  ): Promise<SendOutcome> {
    const tx = this.txHost.tx;
    const [row] = await tx
      .select({
        id: notifications.id,
        channel: notifications.channel,
        status: notifications.status,
        title: notifications.title,
        body: notifications.body,
        data: notifications.data,
        email: users.email,
        phone: users.phoneNumber,
      })
      .from(notifications)
      .innerJoin(users, eq(users.id, notifications.userId))
      .where(eq(notifications.id, notificationId))
      .for('update', { of: notifications });
    // Gone (its event rolled back) or already settled: nothing to do.
    if (!row || row.status !== 'QUEUED' || row.channel === 'IN_APP')
      return 'skipped';

    if (row.channel === 'PUSH' || row.channel === 'WHATSAPP') {
      await tx
        .update(notifications)
        .set({ status: 'SUPPRESSED', error: 'No push provider is configured' })
        .where(eq(notifications.id, row.id));
      this.log.info(
        { event: NOTIFICATION_LOGS.suppressed, notificationId: row.id },
        'push suppressed',
      );
      return 'suppressed';
    }

    const to = row.channel === 'EMAIL' ? realEmail(row.email) : row.phone;
    const link = (row.data as { link?: string } | null)?.link;
    try {
      if (!to)
        throw new ProviderError(
          `No ${row.channel.toLowerCase()} address`,
          false,
        );
      const messageId = await this.deliver({
        channel: row.channel,
        to,
        subject: row.title,
        text:
          row.channel === 'SMS'
            ? `Waypoint: ${row.body}`
            : `${row.body}${link ? `\n\nOpen in Waypoint Compass: ${link}` : ''}`,
      });
      await tx
        .update(notifications)
        .set({
          status: 'SENT',
          provider: this.inbox.enabled ? 'demo-inbox' : 'unknown',
          providerMessageId: messageId,
          attempts: sql`${notifications.attempts} + 1`,
          sentAt: this.clock.now(),
          error: null,
        })
        .where(eq(notifications.id, row.id));
      this.log.info(
        {
          event: NOTIFICATION_LOGS.sent,
          notificationId: row.id,
          channel: row.channel,
        },
        'notification sent',
      );
      return 'sent';
    } catch (err) {
      const failure =
        err instanceof ProviderError
          ? err
          : new ProviderError(
              err instanceof Error ? err.message : String(err),
              true,
            );
      const final = !failure.retryable || attempt >= lastAttempt;
      await tx
        .update(notifications)
        .set({
          status: final ? 'FAILED' : 'QUEUED',
          attempts: sql`${notifications.attempts} + 1`,
          error: failure.message.slice(0, 1_000),
        })
        .where(eq(notifications.id, row.id));
      const fields = {
        notificationId: row.id,
        channel: row.channel,
        attempt,
        retryable: failure.retryable,
      };
      if (final)
        this.log.error(
          { event: NOTIFICATION_LOGS.failed, ...fields },
          'notification failed',
        );
      else
        this.log.warn(
          { event: NOTIFICATION_LOGS.retrying, ...fields },
          'notification send failed; it will be retried',
        );
      return final ? 'failed' : 'retry';
    }
  }

  private async toInbox(delivery: Delivery): Promise<string> {
    if (!this.inbox.enabled)
      throw new ProviderError(
        `No ${delivery.channel === 'SMS' ? 'SMS' : 'email'} provider is configured: set DEMO_MODE=true to use the demo inbox`,
        false,
      );
    await this.inbox.push({
      channel: delivery.channel === 'SMS' ? 'sms' : 'email',
      to: delivery.to,
      body:
        delivery.channel === 'EMAIL'
          ? `${delivery.subject}\n\n${delivery.text}`
          : delivery.text,
      sentAt: this.clock.toIso(this.clock.now()),
    });
    return `demo-${uuidv7()}`;
  }
}
