import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Link } from '@waypoint/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';
import { editOpsSchema } from './edit-op.dto';

const ENGINE_MODES = ['AUTO_SUGGEST', 'REPAIR'] as const;

export class StartEngineRunDto {
  @ApiProperty({ enum: ENGINE_MODES, example: 'AUTO_SUGGEST' })
  @IsIn(ENGINE_MODES)
  mode!: (typeof ENGINE_MODES)[number];

  @ApiProperty({
    example: true,
    description:
      'Keep hand-built trips as they are; false is "Rebuild everything"',
  })
  @IsBoolean()
  keepLocked!: boolean;
}

/** One Auto-suggest or repair run (05, 09 progress strip). */
export class EngineRunDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000e001' })
  id!: string;

  @ApiProperty({ example: '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e' })
  planId!: string;

  @ApiProperty({ enum: ENGINE_MODES, example: 'AUTO_SUGGEST' })
  mode!: string;

  @ApiProperty({
    enum: ['RUNNING', 'SUCCEEDED', 'FAILED'],
    example: 'SUCCEEDED',
  })
  status!: 'RUNNING' | 'SUCCEEDED' | 'FAILED';

  @ApiProperty({ example: '0.3.0' })
  engineVersion!: string;

  @ApiProperty({
    example: '9f2c…',
    description: 'sha256 of the canonical engine input',
  })
  inputHash!: string;

  @ApiProperty({ nullable: true, type: Number, example: 71 })
  servedCount!: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 12 })
  deferredCount!: number | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Limiting resources, utilisation and budget use',
  })
  stats!: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  error!: string | null;

  @ApiProperty({ example: '2026-10-01T16:06:12+05:30' })
  startedAt!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-01T16:06:13+05:30',
  })
  finishedAt!: string | null;

  @ApiLinks()
  _links!: Record<string, Link>;
}

/** An edit list from the wizard (08), the plan editor (10) or a suggested fix (11). */
export class EditPlanDto {
  @ApiProperty({ ...editOpsSchema, minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  ops!: unknown[];

  @ApiPropertyOptional({
    example: 'STORE_REQUEST',
    description: 'Required after publish, and to override a soft rule',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  reasonCode?: string;

  @ApiPropertyOptional({ example: 'Store asked for an early drop' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    example: 'Window is tight but the store opens early for us',
    description: 'Required when the edits cause a soft violation',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  overrideNote?: string;
}

const DECISION_ACTIONS = ['DEFER', 'PLAN_ON', 'SWAP'] as const;

/** What the dispatcher decides for one unplanned order (15, 16). */
export class DeferralDecisionDto {
  @ApiProperty({ example: '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ enum: DECISION_ACTIONS, example: 'DEFER' })
  @IsIn(DECISION_ACTIONS)
  action!: (typeof DECISION_ACTIONS)[number];

  @ApiProperty({
    example: 'OVER_CAPACITY',
    description: 'A code from /deferral-reasons',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  reasonCode!: string;

  @ApiPropertyOptional({
    example: 'Every truck is full tonight; first on tomorrow’s run.',
    description: 'DEFER: required; the store reads it',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ description: 'DEFER of a repeat skip: required' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  overrideNote?: string;

  @ApiPropertyOptional({
    example: 'DRY-31#1',
    description: 'PLAN_ON and SWAP: the trip',
  })
  @IsOptional()
  @IsString()
  tripKey?: string;

  @ApiPropertyOptional({
    description: 'SWAP: the order that comes off the trip',
  })
  @IsOptional()
  @IsUUID()
  swapOrderId?: string;

  @ApiPropertyOptional({
    example: 'OVER_CAPACITY',
    description: 'SWAP: why that order waits',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  swapReasonCode?: string;

  @ApiPropertyOptional({ description: 'SWAP: the note its store reads' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  swapNote?: string;
}

export class DeferralDecisionsDto {
  @ApiProperty({ type: [DeferralDecisionDto] })
  @ValidateNested({ each: true })
  @Type(() => DeferralDecisionDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  decisions!: DeferralDecisionDto[];
}

/** An order on no trip (15), with why and what has been decided. */
export class UnplannedOrderDto {
  @ApiProperty({ example: '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e' })
  orderId!: string;

  @ApiProperty({ example: 'WF-0171' })
  orderNo!: string;

  @ApiProperty({ example: 'OUT014' })
  outletId!: string;

  @ApiProperty({ example: 'Fresh Kadawatha' })
  outletName!: string;

  @ApiProperty({ enum: ['FRESH', 'STYLE', 'TECH'], example: 'FRESH' })
  brand!: string;

  @ApiProperty({ example: 'gampaha' })
  districtId!: string;

  @ApiProperty({ enum: ['CHILLED', 'AMBIENT'], example: 'CHILLED' })
  tempClass!: string;

  @ApiProperty({ example: 24 })
  units!: number;

  @ApiProperty({ example: 312.5 })
  weightKg!: number;

  @ApiProperty({ example: 1.84 })
  volumeM3!: number;

  @ApiProperty({ example: 58 })
  priority!: number;

  @ApiProperty({
    example: false,
    description: 'Its outlet was deferred on its last run',
  })
  repeatSkip!: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'OVER_CAPACITY',
    description:
      'Null when it was taken off by hand and nobody has decided yet',
  })
  reasonCode!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Fleet full' })
  reasonLabel!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'CAP_VOLUME' })
  bindingRule!: string | null;

  @ApiProperty({
    enum: ['UNAVOIDABLE', 'PRIORITY_CHOICE'],
    nullable: true,
    type: String,
    example: 'UNAVOIDABLE',
  })
  choice!: string | null;

  @ApiProperty({
    enum: ['PROPOSED', 'CONFIRMED'],
    nullable: true,
    type: String,
    example: 'PROPOSED',
    description: 'Its live deferral; CONFIRMED once decided, null when none',
  })
  deferralStatus!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  deferralId!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  note!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-03',
    description: 'When it is due if deferred',
  })
  toDate!: string | null;
}

const BLOCKER_KINDS = [
  'HARD_VIOLATION',
  'NO_DRIVER',
  'UNDECIDED_ORDER',
  'NOT_DRAFT',
] as const;

/** One reason the plan cannot be published yet, tied to what to fix (17). */
export class PublishBlockerDto {
  @ApiProperty({ enum: BLOCKER_KINDS, example: 'UNDECIDED_ORDER' })
  kind!: (typeof BLOCKER_KINDS)[number];

  @ApiProperty({ example: 'WF-0171 has no decision yet' })
  message!: string;

  @ApiPropertyOptional({ example: '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e' })
  orderId?: string;

  @ApiPropertyOptional({ example: 'WF-0171' })
  orderNo?: string;

  @ApiPropertyOptional({ example: '0192a3f4-0000-7000-8000-00000000d001' })
  tripId?: string;

  @ApiPropertyOptional({ example: 'DRY-31#2' })
  tripKey?: string;

  @ApiPropertyOptional({ example: 'CAP_WEIGHT' })
  rule?: string;
}

export class PublishNotifyDto {
  @ApiProperty({ example: 4 })
  loaders!: number;

  @ApiProperty({ example: 12 })
  drivers!: number;

  @ApiProperty({
    example: 46,
    description: 'Outlets on a trip or with a deferral',
  })
  stores!: number;
}

/** Whether the plan can be published now, and who hears about it (17, 18). */
export class PublishPreviewDto {
  @ApiProperty({ example: '2026-10-01T16:00:00+05:30' })
  opensAt!: string;

  @ApiProperty({ example: true, description: 'The clock has reached opensAt' })
  open!: boolean;

  @ApiProperty({ type: [PublishBlockerDto] })
  blockers!: PublishBlockerDto[];

  @ApiProperty({ type: PublishNotifyDto })
  notify!: PublishNotifyDto;

  /** self, and publish (POST) only when open with no blockers. */
  @ApiLinks()
  _links!: Record<string, Link>;
}

/** One published change to the plan, with its reason (revision 1 is the publish). */
export class PlanRevisionDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000f001' })
  id!: string;

  @ApiProperty({ example: 2 })
  revision!: number;

  @ApiProperty({ example: 'VEHICLE_BREAKDOWN' })
  reasonCode!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'REF-07 broke down at 04:40',
  })
  note!: string | null;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'The edit list applied',
  })
  changes!: Record<string, unknown>[];

  @ApiProperty({ type: [String] })
  affectedTripIds!: string[];

  @ApiProperty({ type: [String] })
  affectedOutletIds!: string[];

  @ApiProperty({ nullable: true, type: String, example: null })
  createdById!: string | null;

  @ApiProperty({ example: '2026-10-02T04:52:00+05:30' })
  createdAt!: string;
}
