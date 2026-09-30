import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { uuidv7 } from 'uuidv7';

const KEY = 'demo:inbox';
const KEEP = 50;

export interface DemoMessage {
  id: string;
  channel: 'sms' | 'email';
  to: string;
  body: string;
  sentAt: string;
}

/**
 * The last 50 SMS and emails, kept in Redis when DEMO_MODE=true instead of
 * being sent, so judges can read sign-in codes at /demo/inbox. The worker
 * writes it; the API reads it.
 */
@Injectable()
export class DemoInbox implements OnModuleDestroy {
  private readonly redis: Redis;
  readonly enabled: boolean;

  constructor(config: ConfigService) {
    this.enabled = config.get<boolean>('DEMO_MODE') === true;
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  async push(message: Omit<DemoMessage, 'id'>): Promise<void> {
    await this.redis
      .multi()
      .lpush(KEY, JSON.stringify({ id: uuidv7(), ...message }))
      .ltrim(KEY, 0, KEEP - 1)
      .exec();
  }

  /** Newest first. */
  async list(): Promise<DemoMessage[]> {
    const rows = await this.redis.lrange(KEY, 0, KEEP - 1);
    return rows.map((row) => JSON.parse(row) as DemoMessage);
  }

  async clear(): Promise<void> {
    await this.redis.del(KEY);
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
