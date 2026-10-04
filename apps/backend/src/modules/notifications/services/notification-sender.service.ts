import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { eq, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { notifications, users } from '../../../db/schema';
import { realEmail } from '../domain/channels';
import { render } from '../domain/render';
import { NOTIFICATION_LOGS } from '../notifications.constants';
import {
  type Delivery,
  OutboundProviders,
  ProviderError,
  type Sent,
} from './providers';

export { ProviderError, type Delivery } from './providers';

/** `retry`: the row is still QUEUED and the job should throw so BullMQ backs off. */
export type SendOutcome =
  'sent' | 'suppressed' | 'skipped' | 'failed' | 'retry';

/**
 * Sends one EMAIL, SMS or PUSH row from the worker's notify.send job and
 * records what happened on it: the provider and its message id, which is
 * what a delivery receipt later finds the row by (AC-NTF-08). Where each
 * channel goes is OutboundProviders' choice. Push has no provider yet, so its
 * rows are SUPPRESSED, not failed.
 */
@Injectable()
export class NotificationSender {
  /** Swapped in tests to make the provider fail. */
  deliver: (delivery: Delivery) => Promise<Sent> = (d) =>
    this.providers.deliver(d);

  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly providers: OutboundProviders,
    private readonly clock: ClockService,
    private readonly config: ConfigService,
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
        eventType: notifications.eventType,
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
    const data = (row.data ?? {}) as {
      link?: string;
      entity?: { id?: string | null };
    };
    const rendered = render(
      row.channel,
      { title: row.title, body: row.body, link: data.link ?? '/' },
      { eventType: row.eventType, entityId: data.entity?.id },
      this.config.get<string>('APP_URL') ?? '',
    );
    try {
      if (!to)
        throw new ProviderError(
          `No ${row.channel.toLowerCase()} address`,
          false,
        );
      const sent = await this.deliver({
        notificationId: row.id,
        channel: row.channel,
        to,
        subject: row.title,
        text:
          rendered.channel === 'SMS' || rendered.channel === 'EMAIL'
            ? rendered.text
            : row.body,
      });
      await tx
        .update(notifications)
        .set({
          status: 'SENT',
          provider: sent.provider,
          providerMessageId: sent.messageId,
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
}
