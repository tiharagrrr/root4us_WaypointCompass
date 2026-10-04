import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/** Longer than two heartbeats, so a live stream never lapses between them. */
export const PRESENCE_TTL_SECONDS = 40;
const key = (userId: string) => `presence:user:${userId}`;

/**
 * Who has the app open right now: a key per user in Redis while one of their
 * streams is open on any instance, refreshed by its heartbeat and left to
 * expire when the last one goes. Notifications reads it so a person looking
 * at the screen gets the in-app line and no push (AC-NTF-12).
 */
@Injectable()
export class PresenceService implements OnModuleDestroy {
  private redis?: Redis;
  /** Streams per user on this instance, so closing one tab keeps the others present. */
  private readonly local = new Map<string, number>();

  constructor(private readonly config: ConfigService) {}

  async opened(userId: string): Promise<void> {
    this.local.set(userId, (this.local.get(userId) ?? 0) + 1);
    await this.touch(userId);
  }

  async touch(userId: string): Promise<void> {
    await this.client().set(key(userId), '1', 'EX', PRESENCE_TTL_SECONDS);
  }

  async closed(userId: string): Promise<void> {
    const left = (this.local.get(userId) ?? 1) - 1;
    if (left > 0) return void this.local.set(userId, left);
    this.local.delete(userId);
    // Another instance may still hold a stream for them; it re-sets the key on its next beat.
    await this.client().del(key(userId));
  }

  /** The users among these with the app open. */
  async watching(userIds: readonly string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const values = await this.client().mget(...userIds.map(key));
    return new Set(userIds.filter((_, i) => values[i] !== null));
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }

  private client(): Redis {
    this.redis ??= new Redis(this.config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: 1,
    });
    return this.redis;
  }
}
