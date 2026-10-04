import { uuidv7 } from 'uuidv7';
import type { ClockService } from '../clock/clock.service';
import type { DemoInbox } from '../demo/demo-inbox';
import { InvalidPhoneNumber, toE164 } from '../phone/sri-lanka-phone';
import {
  ProviderError,
  type SendResult,
  type SmsMessage,
  type SmsProvider,
} from './ports';

/**
 * SMS_PROVIDER=demo-inbox, the default: nothing leaves the machine. Messages
 * land in Redis for /api/v1/demo/inbox, so a sign-in code can be read without
 * a phone, a key or an account anywhere. The local stack and CI run on this.
 *
 * It still normalises the number, so a number the real gateways would refuse
 * is refused here too and the demo does not pass what production fails.
 */
export class DemoInboxSmsProvider implements SmsProvider {
  readonly name = 'demo-inbox';

  constructor(
    private readonly inbox: DemoInbox,
    private readonly clock: ClockService,
  ) {}

  async send(message: SmsMessage): Promise<SendResult> {
    if (!this.inbox.enabled)
      throw new ProviderError(
        'No SMS provider is configured: set DEMO_MODE=true for the demo inbox, or SMS_PROVIDER=notifylk | textlk | twilio with the keys for that gateway',
        false,
      );
    let to: string;
    try {
      to = toE164(message.to);
    } catch (error: unknown) {
      if (error instanceof InvalidPhoneNumber)
        throw new ProviderError(error.message, false, 'invalid_number');
      throw error;
    }
    await this.inbox.push({
      channel: 'sms',
      to,
      body: message.text,
      sentAt: this.clock.toIso(this.clock.now()),
    });
    return { provider: this.name, providerMessageId: `demo-${uuidv7()}` };
  }

  /** Healthy when demo mode is on; off, it can accept nothing. */
  health(): Promise<boolean> {
    return Promise.resolve(this.inbox.enabled);
  }
}
