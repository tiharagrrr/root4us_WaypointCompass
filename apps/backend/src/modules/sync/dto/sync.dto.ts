import {
  ApiProperty,
  ApiPropertyOptional,
  type ApiBodyOptions,
} from '@nestjs/swagger';
import {
  SYNC_RESULT_STATUSES,
  type Link,
  type SyncResultStatus,
} from '@waypoint/shared';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';

/** One event's verdict, keyed by the clientUuid the device made. */
export class SyncResultDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-0000000000aa' })
  clientUuid!: string;

  @ApiProperty({ enum: SYNC_RESULT_STATUSES, enumName: 'SyncResultStatus' })
  status!: SyncResultStatus;

  @ApiPropertyOptional({
    example: 'VALIDATION_FAILED',
    description: 'Why, for conflict and rejected',
  })
  code?: string;

  @ApiPropertyOptional({ example: 'Who took the delivery?' })
  message?: string;

  @ApiPropertyOptional({
    example: '0192a3f4-0000-7000-8000-0000000000bb',
    description: 'The row the event touched, so the device can reconcile',
  })
  id?: string;
}

/** What POST /sync answers: a result per event and the batch's counts. */
export class SyncResponseDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-0000000000cc' })
  batchId!: string;

  @ApiProperty({ type: [SyncResultDto] })
  results!: SyncResultDto[];

  @ApiProperty({ example: 6 })
  received!: number;

  @ApiProperty({ example: 5 })
  applied!: number;

  @ApiProperty({ example: 1 })
  duplicates!: number;

  @ApiProperty({ example: 0 })
  conflicts!: number;

  @ApiProperty({ example: 0 })
  rejected!: number;

  @ApiLinks()
  _links!: Record<string, Link>;
}

/**
 * The request body for Swagger. The real contract is `syncEventSchema` in @waypoint/shared, a
 * union the server parses event by event; this hand-written schema documents it.
 */
export const SYNC_BATCH_API_BODY: ApiBodyOptions = {
  description:
    'A device outbox: up to 100 driver or loader events in deviceSeq order. Each event is validated on its own; one bad event is one rejected result, never a 400.',
  schema: {
    type: 'object',
    required: ['deviceId', 'events'],
    properties: {
      deviceId: { type: 'string', example: 'dock-plg-01' },
      events: {
        type: 'array',
        maxItems: 100,
        items: {
          type: 'object',
          required: ['clientUuid', 'tripId', 'type', 'occurredAt'],
          properties: {
            clientUuid: { type: 'string', format: 'uuid' },
            tripId: { type: 'string', format: 'uuid' },
            type: {
              type: 'string',
              description:
                'A StopEventType (driver) or LOAD_LINE_CHECKED, LOAD_CHECK_UNDONE, LOAD_FLAG_RAISED, LOAD_FLAG_UNDONE, LOAD_RECHECKED (loader)',
              example: 'DELIVERED',
            },
            occurredAt: { type: 'string', format: 'date-time' },
            deviceTime: { type: 'string' },
            deviceSeq: { type: 'integer', minimum: 0 },
            baseVersion: { type: 'integer', minimum: 0 },
            note: { type: 'string', maxLength: 2000 },
            attachmentUuids: {
              type: 'array',
              items: { type: 'string', format: 'uuid' },
            },
            stopId: { type: 'string', format: 'uuid' },
            outcome: { type: 'string' },
            receiverName: { type: 'string', maxLength: 200 },
            reasonCode: { type: 'string' },
            lines: {
              type: 'array',
              items: {
                type: 'object',
                required: ['orderLineId', 'qtyDelivered', 'condition'],
                properties: {
                  orderLineId: { type: 'string', format: 'uuid' },
                  qtyDelivered: { type: 'integer', minimum: 0 },
                  condition: {
                    type: 'string',
                    enum: ['ok', 'damaged', 'refused'],
                  },
                  note: { type: 'string' },
                },
              },
            },
            reeferTempC: { type: 'number' },
            lat: { type: 'number' },
            lng: { type: 'number' },
            loadLineId: { type: 'string', format: 'uuid' },
            loadFlagId: { type: 'string', format: 'uuid' },
            checkedByName: { type: 'string', maxLength: 120 },
            qtyLoaded: { type: 'integer', minimum: 0 },
            reason: { type: 'string' },
            qtyAffected: { type: 'integer', minimum: 0 },
            photoClientUuid: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
  },
};

/** Query of `GET /sync/changes`: where the device read up to, and how many it wants. */
export class ChangesQueryDto {
  @ApiPropertyOptional({
    description:
      'The meta.page.nextCursor of the previous pull. Without it the feed starts at the first change for the device',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  since?: string;

  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/** One server change for a device's trip. */
export class SyncChangeDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-0000000000dd' })
  id!: string;

  @ApiProperty({
    example: 'trip.resequenced',
    description:
      'plan.revised, trip.reassigned, trip.resequenced, trip.cancelled, stop.deferred or load.flag_decided',
  })
  type!: string;

  @ApiProperty({ example: '2026-10-02T04:35:00.000Z' })
  occurredAt!: string;

  @ApiProperty({ type: String, nullable: true })
  tripId!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'The event payload, with v: 1',
  })
  data!: Record<string, unknown>;

  @ApiLinks()
  _links!: Record<string, Link>;
}
