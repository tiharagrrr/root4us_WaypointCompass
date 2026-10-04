import { ApiProperty } from '@nestjs/swagger';
import type { Link } from '@waypoint/shared';
import { ApiLinks } from '../../../core/http/decorators';

/** One step of an entity's history: what happened, who did it, from where and why. */
export class TimelineEntryDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000a001' })
  id!: string;

  @ApiProperty({ description: 'Position in the audit chain', example: 4211 })
  seq!: number;

  @ApiProperty({
    description: '<module>.<entity>.<verb>',
    example: 'ordering.order.submitted',
  })
  action!: string;

  @ApiProperty({
    description: 'The entity the step was recorded on',
    example: 'order',
  })
  entityType!: string;

  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000o001' })
  entityId!: string;

  @ApiProperty({ nullable: true, type: String, example: 'usr_nimesha' })
  actorId!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Null for a step the system took',
    example: 'Nimesha Periyapperuma',
  })
  actorName!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'store_manager' })
  actorRole!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'dev_7f3a' })
  deviceId!: string | null;

  @ApiProperty({
    description:
      'WEB, PWA, OFFLINE_SYNC, ENGINE, SYSTEM, SIMULATION or WEBHOOK',
    example: 'WEB',
  })
  source!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'The status the entity moved to, when the step set one',
    example: 'SUBMITTED',
  })
  status!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  reasonCode!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  reasonNote!: string | null;

  @ApiProperty({
    description: 'When it happened: device or business time',
    example: '2026-10-01T14:02:11+05:30',
  })
  occurredAt!: string;

  @ApiProperty({
    description: 'When the server recorded it',
    example: '2026-10-01T14:02:11+05:30',
  })
  recordedAt!: string;

  @ApiProperty({
    description:
      'True when recordedAt trails occurredAt by more than 5 minutes: an offline event that synced late',
    example: false,
  })
  syncedLate!: boolean;

  @ApiLinks()
  _links!: Record<string, Link>;
}
