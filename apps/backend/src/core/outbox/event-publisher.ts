import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { EVENTS_CHANNEL, type DeliveredEvent } from './event-bus';

/**
 * Publishes a relayed event on Redis, where the SSE gateway (ROO-25) fans it
 * out to the screens. The client connects on first use, so the API process,
 * which never relays, never opens it.
 */
@Injectable()
export class EventPublisher implements OnModuleDestroy {
  private redis?: Redis;

  constructor(private readonly config: ConfigService) {}

  async publish(event: DeliveredEvent): Promise<void> {
    this.redis ??= new Redis(this.config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: 1,
    });
    await this.redis.publish(EVENTS_CHANNEL, JSON.stringify(event));
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }
}
