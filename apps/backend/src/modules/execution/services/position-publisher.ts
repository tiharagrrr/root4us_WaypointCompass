import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  EVENTS_CHANNEL,
  type DeliveredEvent,
} from '../../../core/outbox/event-bus';
import { PUBLISH_EVERY_MS } from '../domain/pings';

export interface PositionUpdate {
  vehicleId: string;
  vehicleCode: string;
  tripId: string;
  depotId: string;
  lat: number;
  lng: number;
  heading: number | null;
  speedKmh: number | null;
  recordedAt: Date;
}

/**
 * Sends `vehicle.position` straight to the SSE fan-out, never through the
 * outbox (specs/execution/spec.md, Events): a position is stale in seconds, so
 * it is neither stored as an event nor replayed. A Redis key per vehicle lets
 * one through every 5 seconds across every API instance (AC-EXE-17). Its id is
 * `<vehicleId>:<recordedAt>`; the realtime gateway keeps stores from seeing it.
 */
@Injectable()
export class PositionPublisher implements OnModuleDestroy {
  private redis?: Redis;

  constructor(private readonly config: ConfigService) {}

  /** True when the update went out; false when the vehicle published within the window. */
  async publish(update: PositionUpdate): Promise<boolean> {
    const redis = this.client();
    const gate = await redis.set(
      `position:throttle:${update.vehicleId}`,
      '1',
      'PX',
      PUBLISH_EVERY_MS,
      'NX',
    );
    if (gate !== 'OK') return false;
    const recordedAt = update.recordedAt.toISOString();
    const event: DeliveredEvent = {
      id: `${update.vehicleId}:${recordedAt}`,
      type: 'vehicle.position',
      aggregateType: 'vehicle',
      aggregateId: update.vehicleId,
      depotId: update.depotId,
      outletIds: [],
      userIds: [],
      payload: {
        v: 1,
        vehicleId: update.vehicleId,
        vehicleCode: update.vehicleCode,
        tripId: update.tripId,
        lat: update.lat,
        lng: update.lng,
        heading: update.heading,
        speedKmh: update.speedKmh,
        recordedAt,
      },
      occurredAt: update.recordedAt,
      correlationId: null,
    };
    await redis.publish(EVENTS_CHANNEL, JSON.stringify(event));
    return true;
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
