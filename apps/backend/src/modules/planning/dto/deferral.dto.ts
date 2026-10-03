import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Link } from '@waypoint/shared';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';

/**
 * A deferral as dispatchers (23) and stores (M4, M7) read it. A store sees
 * the reason in the store's words and the dispatcher's note, never the
 * engine's numbers: `choice`, `bindingRule` and `priorityScore` are null for
 * a store manager (AC-PLN-16).
 */
export class DeferralDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000a101' })
  id!: string;

  @ApiProperty({ example: '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e' })
  orderId!: string;

  @ApiProperty({ example: 'WF-0171' })
  orderNo!: string;

  @ApiProperty({
    example: 'DEFERRED',
    description:
      "The order's status now: DEFERRED until a later run carries it",
  })
  orderStatus!: string;

  @ApiProperty({ example: 'OUT014' })
  outletId!: string;

  @ApiProperty({ example: 'Fresh Kadawatha' })
  outletName!: string;

  @ApiProperty({ enum: ['FRESH', 'STYLE', 'TECH'], example: 'FRESH' })
  outletBrand!: string;

  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000b201' })
  planId!: string;

  @ApiProperty({
    enum: ['PROPOSED', 'CONFIRMED', 'REVERSED', 'CANCELLED'],
    example: 'CONFIRMED',
  })
  status!: string;

  @ApiProperty({
    enum: ['ENGINE', 'PLANNING', 'LOAD_CHECK', 'TRACKING'],
    example: 'ENGINE',
  })
  source!: string;

  @ApiProperty({ example: 'OVER_CAPACITY' })
  reasonCode!: string;

  @ApiProperty({ example: 'Fleet full' })
  reasonLabel!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Every suitable vehicle was full for this run.',
    description:
      'What the store reads; null for a manual reason, where the note says it',
  })
  reasonText!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'First on tomorrow’s run.',
    description: "The dispatcher's note to the store",
  })
  note!: string | null;

  @ApiProperty({ example: '2026-10-02' })
  fromDate!: string;

  @ApiProperty({
    example: '2026-10-03',
    description: 'The run it is due on now',
  })
  toDate!: string;

  @ApiProperty({
    example: false,
    description: 'Its outlet was deferred on the run before too',
  })
  repeatSkip!: boolean;

  @ApiProperty({
    example: false,
    description: 'Part of the order, removed at the dock',
  })
  partial!: boolean;

  @ApiProperty({
    enum: ['AWAITING', 'ACKNOWLEDGED', 'PRIORITY_REQUESTED'],
    example: 'AWAITING',
  })
  storeResponse!: string;

  @ApiProperty({ nullable: true, type: String, example: null })
  storeNote!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  storeRespondedAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Nimesha Periyapperuma',
    description: 'Who answered for the store',
  })
  storeRespondedByName!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-01T16:12:00+05:30',
  })
  decidedAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Tihara Egodage',
    description: 'Who decided it; null for an engine proposal nobody confirmed',
  })
  decidedByName!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Pinned to Friday’s first run',
    description: 'The dispatcher’s reply to the store (23), shown on M4',
  })
  dispatcherReply!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  dispatcherRepliedAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 2,
    description:
      'Dispatchers only: the outlet’s live deferrals in the 30 days up to this one',
  })
  skips30d!: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 3,
    description:
      'Dispatchers only: of the depot’s last recentRuns plans up to this one, how many deferred this outlet',
  })
  recentSkips!: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 5,
    description: 'Dispatchers only: the runs recentSkips counts over, up to 5',
  })
  recentRuns!: number | null;

  @ApiProperty({
    enum: ['UNAVOIDABLE', 'PRIORITY_CHOICE'],
    nullable: true,
    type: String,
    example: 'UNAVOIDABLE',
    description: 'Dispatchers only',
  })
  choice!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'CAP_VOLUME',
    description: 'Dispatchers only',
  })
  bindingRule!: string | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 58,
    description: 'Dispatchers only',
  })
  priorityScore!: number | null;

  @ApiProperty({ example: '2026-10-01T16:06:13+05:30' })
  createdAt!: string;

  /** self, order, respond (POST, store manager while AWAITING), reverse and reply (POST, dispatcher). */
  @ApiLinks()
  _links!: Record<string, Link>;
}

const STORE_RESPONSES = ['ACKNOWLEDGED', 'PRIORITY_REQUESTED'] as const;

/** M4: the store acknowledges, or asks for priority with a note. */
export class DeferralResponseDto {
  @ApiProperty({ enum: STORE_RESPONSES, example: 'ACKNOWLEDGED' })
  @IsIn(STORE_RESPONSES)
  response!: (typeof STORE_RESPONSES)[number];

  @ApiPropertyOptional({
    example: 'We run out of milk by noon; please bring it first thing.',
    description: 'Required with PRIORITY_REQUESTED',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** 19c: keep the delivery the driver's phone recorded. */
export class ReverseDeferralDto {
  @ApiProperty({
    example: 'Delivered while offline; keeping the device’s record',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

/** 23: the dispatcher's one reply to the store. */
export class ReplyDeferralDto {
  @ApiProperty({ example: 'Pinned to Friday’s first run' })
  @IsString()
  @MaxLength(500)
  text!: string;
}
