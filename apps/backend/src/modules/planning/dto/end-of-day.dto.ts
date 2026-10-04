import { ApiProperty } from '@nestjs/swagger';
import type { Link } from '@waypoint/shared';
import { Type } from 'class-transformer';
import { ApiLinks } from '../../../core/http/decorators';

const FOLLOW_UP_KINDS = [
  'FAILED_STOP',
  'SHORT',
  'ISSUE',
  'NOT_REACHED',
  'SYNC_CONFLICT',
] as const;

/** 21's stat cards: every live stop on the day's trips, by what happened to it. */
export class EndOfDayTotalsDto {
  @ApiProperty({ example: 148, description: 'Live stops on the day’s trips' })
  stops!: number;

  @ApiProperty({ example: 144 })
  delivered!: number;

  @ApiProperty({ example: 3 })
  partial!: number;

  @ApiProperty({ example: 2 })
  failed!: number;

  @ApiProperty({
    example: 0,
    description: 'Stops nobody reached; closing the day defers them',
  })
  unserved!: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 93,
    description:
      'Whole percent of stops with an arrival that arrived inside the window; null before any arrival',
  })
  onTimePct!: number | null;

  @ApiProperty({
    example: 7,
    description: 'Confirmed deferrals on this plan',
  })
  deferred!: number;
}

/** One row of 21's table. */
export class EndOfDayTripDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000c101' })
  tripId!: string;

  @ApiProperty({ example: 'REF-07' })
  vehicleCode!: string;

  @ApiProperty({ example: 1 })
  tripNo!: number;

  @ApiProperty({ nullable: true, type: String, example: 'Aniqa Razick' })
  driverName!: string | null;

  @ApiProperty({
    enum: [
      'RESERVED',
      'PLANNED',
      'LOADING',
      'RELEASED',
      'IN_PROGRESS',
      'COMPLETED',
    ],
    example: 'COMPLETED',
  })
  status!: string;

  @ApiProperty({ example: 10 })
  stops!: number;

  @ApiProperty({ example: 8 })
  delivered!: number;

  @ApiProperty({ example: 1 })
  partial!: number;

  @ApiProperty({ example: 1 })
  failed!: number;

  @ApiProperty({ nullable: true, type: Number, example: 90 })
  onTimePct!: number | null;

  @ApiProperty({
    example: 0,
    description: 'Open sync conflicts (19c) on this trip',
  })
  openConflicts!: number;
}

/** Something the dispatcher should look at before closing the day. */
export class EndOfDayFollowUpDto {
  @ApiProperty({ enum: FOLLOW_UP_KINDS, example: 'FAILED_STOP' })
  kind!: (typeof FOLLOW_UP_KINDS)[number];

  @ApiProperty({ example: 'Failed stop · Tech Negombo' })
  title!: string;

  @ApiProperty({ example: 'Outlet closed on arrival.' })
  detail!: string;

  @ApiProperty({ nullable: true, type: String, example: null })
  tripId!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  orderId!: string | null;
}

/** 21 End-of-day summary: the day's results per trip, and whether it can be closed. */
export class EndOfDayDto {
  @ApiProperty({ example: '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e' })
  planId!: string;

  @ApiProperty({ example: 'PLG' })
  depotId!: string;

  @ApiProperty({ example: '2026-10-02' })
  date!: string;

  @ApiProperty({ enum: ['DRAFT', 'PUBLISHED', 'CLOSED'], example: 'PUBLISHED' })
  status!: string;

  @ApiProperty({ nullable: true, type: String, example: null })
  closedAt!: string | null;

  @ApiProperty({ type: EndOfDayTotalsDto })
  @Type(() => EndOfDayTotalsDto)
  totals!: EndOfDayTotalsDto;

  @ApiProperty({ type: [EndOfDayTripDto] })
  @Type(() => EndOfDayTripDto)
  trips!: EndOfDayTripDto[];

  @ApiProperty({ type: [EndOfDayFollowUpDto] })
  @Type(() => EndOfDayFollowUpDto)
  followUps!: EndOfDayFollowUpDto[];

  @ApiProperty({
    type: [String],
    example: ['REF-03 is still on the road'],
    description: 'Why the day cannot be closed yet; empty when it can',
  })
  closeBlockers!: string[];

  /** self, plan, close (POST, If-Match) when the day can be closed. */
  @ApiLinks()
  _links!: Record<string, Link>;
}
