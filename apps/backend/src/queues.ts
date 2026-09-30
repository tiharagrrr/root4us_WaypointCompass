import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

export const QUEUES = {
  allocation: 'allocation',
  notifications: 'notifications',
  outbox: 'outbox',
  /** One job a minute that runs every @OnTick handler (core/scheduling). */
  ticker: 'ticker',
} as const;

export const BullRootModule = BullModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const url = new URL(config.getOrThrow<string>('REDIS_URL'));
    return {
      connection: {
        host: url.hostname,
        port: Number(url.port || 6379),
        password: url.password || undefined,
        maxRetriesPerRequest: null,
      },
    };
  },
});
