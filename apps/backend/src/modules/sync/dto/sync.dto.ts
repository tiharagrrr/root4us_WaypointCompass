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
