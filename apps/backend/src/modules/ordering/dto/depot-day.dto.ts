import { ApiProperty } from '@nestjs/swagger';
import type { Link } from '@waypoint/shared';
import { ApiLinks } from '../../../core/http/decorators';

/** How the cutoff stands for one depot and delivery date. */
export class CutoffStateDto {
  @ApiProperty({ example: '2026-10-01T16:00:00+05:30' })
  at!: string;

  @ApiProperty({ description: 'Minutes after midnight', example: 960 })
  cutoffMin!: number;

  @ApiProperty({
    description: 'The clock has passed the cutoff',
    example: false,
  })
  passed!: boolean;

  @ApiProperty({
    description: 'Every submitted order for the day has been confirmed',
    example: false,
  })
  closed!: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'When the day was closed, if it has been',
    example: null,
  })
  closedAt!: string | null;

  @ApiProperty({
    description: 'Minutes left before the cutoff; 0 once it has passed',
    example: 48,
  })
  minutesLeft!: number;
}

/**
 * The day's order queue in one number per group, for 01 Today and 03 Order
 * queue: how many orders sit in each status, brand and class, and where the
 * cutoff stands (AC-ORD-35).
 */
export class DepotDaySummaryDto {
  @ApiProperty({ example: 'PLG' })
  depotId!: string;

  @ApiProperty({ example: '2026-10-02' })
  date!: string;

  @ApiProperty({
    description: 'Orders on this run, whatever their status',
    example: 57,
  })
  total!: number;

  @ApiProperty({
    description: 'Count by order status',
    example: { SUBMITTED: 12, CONFIRMED: 45 },
    additionalProperties: { type: 'number' },
    type: 'object',
  })
  byStatus!: Record<string, number>;

  @ApiProperty({
    description: 'Count by brand',
    example: { FRESH: 40, STYLE: 10, TECH: 7 },
    additionalProperties: { type: 'number' },
    type: 'object',
  })
  byBrand!: Record<string, number>;

  @ApiProperty({
    description: 'Count by temperature class',
    example: { AMBIENT: 44, CHILLED: 13 },
    additionalProperties: { type: 'number' },
    type: 'object',
  })
  byClass!: Record<string, number>;

  @ApiProperty({
    description: 'Orders the dispatcher marked urgent',
    example: 2,
  })
  urgent!: number;

  @ApiProperty({
    description: 'Orders that came in after the cutoff',
    example: 3,
  })
  afterCutoff!: number;

  @ApiProperty({ description: 'Packs across the day', example: 2314 })
  units!: number;

  @ApiProperty({ example: 18240.5 })
  weightKg!: number;

  @ApiProperty({ example: 86.4 })
  volumeM3!: number;

  @ApiProperty({ type: CutoffStateDto })
  cutoff!: CutoffStateDto;

  @ApiLinks()
  _links!: Record<string, Link>;
}

/** What POST /depots/{id}/days/{date}/close-cutoff answers (demo mode). */
export class CloseCutoffResultDto {
  @ApiProperty({ example: 'PLG' })
  depotId!: string;

  @ApiProperty({ example: '2026-10-02' })
  date!: string;

  @ApiProperty({ description: 'Orders moved to CONFIRMED', example: 3 })
  confirmed!: number;

  @ApiProperty({
    description: 'False when the day was already closed',
    example: true,
  })
  closed!: boolean;

  @ApiLinks()
  _links!: Record<string, Link>;
}
