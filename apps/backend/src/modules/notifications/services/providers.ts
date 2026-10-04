import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { uuidv7 } from 'uuidv7';
import { ClockService } from '../../../core/clock/clock.service';
import { DemoInbox } from '../../../core/demo/demo-inbox';

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

/** One message on its way out. */
export interface Delivery {
  /** The notification row: the provider's idempotency key, so a retried job never sends twice. */
  notificationId: string;
  channel: 'EMAIL' | 'SMS';
  to: string;
  subject: string;
  text: string;
}

export interface Sent {
  provider: string;
  messageId: string;
}

const RESEND_URL = 'https://api.resend.com/emails';

/**
 * Picks where each message goes. Email: Resend when EMAIL_PROVIDER=resend (or
 * a key is set and no provider named), else the demo inbox. SMS: the demo
 * inbox until an SMS provider is wired. With DEMO_MODE=true every email also
 * leaves a copy in the demo inbox, so judges see what was sent (AC-NTF-15).
 * No provider at all is a permanent failure, never a retry loop.
 */
@Injectable()
export class OutboundProviders {
  private readonly emailProvider: 'resend' | 'demo-inbox';

  constructor(
    private readonly config: ConfigService,
    private readonly inbox: DemoInbox,
    private readonly clock: ClockService,
  ) {
    const named = config.get<'resend' | 'demo-inbox'>('EMAIL_PROVIDER');
    this.emailProvider =
      named ?? (config.get<string>('RESEND_API_KEY') ? 'resend' : 'demo-inbox');
  }

  async deliver(delivery: Delivery): Promise<Sent> {
    if (delivery.channel === 'EMAIL' && this.emailProvider === 'resend') {
      const messageId = await this.resend(delivery);
      if (this.inbox.enabled) await this.copyToInbox(delivery);
      return { provider: 'resend', messageId };
    }
    if (!this.inbox.enabled)
      throw new ProviderError(
        `No ${delivery.channel === 'SMS' ? 'SMS' : 'email'} provider is configured: set DEMO_MODE=true to use the demo inbox${delivery.channel === 'EMAIL' ? ', or EMAIL_PROVIDER=resend with RESEND_API_KEY' : ''}`,
        false,
      );
    await this.copyToInbox(delivery);
    return { provider: 'demo-inbox', messageId: `demo-${uuidv7()}` };
  }

  private async resend(delivery: Delivery): Promise<string> {
    const key = this.config.get<string>('RESEND_API_KEY');
    if (!key)
      throw new ProviderError(
        'EMAIL_PROVIDER=resend needs RESEND_API_KEY',
        false,
      );
    let res: Response;
    try {
      res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': delivery.notificationId,
        },
        body: JSON.stringify({
          from: this.config.get<string>('EMAIL_FROM'),
          to: [delivery.to],
          subject: delivery.subject,
          text: delivery.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      // Timeouts and network failures: Resend may be fine a minute from now.
      throw new ProviderError(
        `Resend unreachable: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }
    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
    };
    if (res.ok && body.id) return body.id;
    // 429 and 5xx pass; any other 4xx (bad address, unverified domain) will not.
    const retryable = res.status === 429 || res.status >= 500;
    throw new ProviderError(
      `Resend ${res.status}: ${body.message ?? body.name ?? 'refused'}`,
      retryable,
    );
  }

  private copyToInbox(delivery: Delivery): Promise<void> {
    return this.inbox.push({
      channel: delivery.channel === 'SMS' ? 'sms' : 'email',
      to: delivery.to,
      body:
        delivery.channel === 'EMAIL'
          ? `${delivery.subject}\n\n${delivery.text}`
          : delivery.text,
      sentAt: this.clock.toIso(this.clock.now()),
    });
  }
}
