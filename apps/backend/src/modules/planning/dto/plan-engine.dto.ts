import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  RULE_CODES,
  RULE_SCOPES,
  SEVERITIES,
  type EditOp,
} from '@waypoint/engine';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { editOpsSchema } from './edit-op.dto';

/**
 * One broken planning rule, exactly as the engine's validate() reports it
 * (packages/engine/src/types.ts, Violation), so the web shows the same
 * message the browser's copy of the engine would.
 */
export class ViolationDto {
  @ApiProperty({
    enum: RULE_CODES,
    enumName: 'RuleCode',
    example: 'CAP_VOLUME',
  })
  @IsIn(RULE_CODES)
  rule!: (typeof RULE_CODES)[number];

  @ApiProperty({ enum: SEVERITIES, enumName: 'Severity', example: 'HARD' })
  @IsIn(SEVERITIES)
  severity!: (typeof SEVERITIES)[number];

  @ApiProperty({ enum: RULE_SCOPES, enumName: 'RuleScope', example: 'trip' })
  @IsIn(RULE_SCOPES)
  scope!: (typeof RULE_SCOPES)[number];

  @ApiPropertyOptional({ example: 'REF-07#1' })
  @IsOptional()
  @IsString()
  tripKey?: string;

  @ApiPropertyOptional({ example: 'VEH014' })
  @IsOptional()
  @IsString()
  vehicleId?: string;

  @ApiPropertyOptional({ example: '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e' })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({ example: 12.42 })
  @IsOptional()
  @IsNumber()
  actual?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsNumber()
  limit?: number;

  @ApiProperty({ example: 'Over volume by 0.42 m³' })
  @IsString()
  message!: string;
}

/** What a trip would weigh and take with an order on it (07). */
export class TripTotalsDto {
  @ApiProperty({ example: 2840 })
  weightKg!: number;

  @ApiProperty({ example: 11.6 })
  volumeM3!: number;

  @ApiProperty({
    example: 213,
    description: 'Trip minutes, return leg excluded',
  })
  minutes!: number;

  @ApiProperty({ example: 14.2 })
  litres!: number;
}

/** A vehicle and what it has left today (06), from the engine's vehicleOptions(). */
export class PlanVehicleOptionDto {
  @ApiProperty({ example: 'VEH014' })
  vehicleId!: string;

  @ApiProperty({ example: 'REF-07' })
  code!: string;

  @ApiProperty({ enum: ['TRUCK', 'VAN'], example: 'TRUCK' })
  type!: string;

  @ApiProperty({ enum: ['AMBIENT', 'REEFER'], example: 'REEFER' })
  temp!: string;

  @ApiProperty({
    enum: [
      'AVAILABLE',
      'NO_TRIPS_LEFT',
      'WORKSHOP',
      'BREAKDOWN',
      'UNAVAILABLE',
    ],
    example: 'AVAILABLE',
  })
  status!: string;

  @ApiProperty({ example: true })
  available!: boolean;

  @ApiProperty({
    enum: ['WORKSHOP', 'BREAKDOWN'],
    nullable: true,
    type: String,
    example: null,
  })
  unavailableReason!: 'WORKSHOP' | 'BREAKDOWN' | null;

  @ApiProperty({ example: 1 })
  tripsUsed!: number;

  @ApiProperty({ example: 1 })
  tripsLeft!: number;

  @ApiProperty({ nullable: true, type: Number, example: 2 })
  nextTripNo!: number | null;

  @ApiProperty({ example: 169 })
  freshMinutesLeft!: number;

  @ApiProperty({ example: 480 })
  styleTechMinutesLeft!: number;

  @ApiProperty({ example: 3000 })
  weightCapKg!: number;

  @ApiProperty({ example: 12 })
  volumeCapM3!: number;

  @ApiProperty({
    example: 61.5,
    description: 'Weekly quota less what is used and planned',
  })
  fuelLeftL!: number;

  @ApiProperty({ example: 400, description: 'Weekly fuel quota, litres' })
  weeklyFuelQuotaL!: number;
}

export class OrderOptionsQueryDto {
  @ApiProperty({ example: 'VEH014' })
  @IsString()
  vehicleId!: string;

  @ApiProperty({ example: 1, minimum: 1, maximum: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2)
  tripNo!: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'Orders already picked in the wizard (repeat the parameter)',
  })
  @IsOptional()
  @IsString({ each: true })
  @ArrayMaxSize(100)
  selected?: string[];
}

/** An order the wizard could put on a trip (07), best first, from the engine's optionsForTrip(). */
export class OrderOptionDto {
  @ApiProperty({ example: '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e' })
  orderId!: string;

  @ApiProperty({ example: 'WF-0171' })
  ref!: string;

  @ApiProperty({ enum: ['FITS', 'WARNING', 'BLOCKED'], example: 'FITS' })
  status!: 'FITS' | 'WARNING' | 'BLOCKED';

  @ApiProperty({ example: 58 })
  priority!: number;

  @ApiProperty({
    type: [ViolationDto],
    description: 'Why it is dimmed; empty unless BLOCKED',
  })
  blocking!: ViolationDto[];

  @ApiProperty({ type: [ViolationDto] })
  warnings!: ViolationDto[];

  @ApiProperty({
    type: TripTotalsDto,
    description: 'The trip with this order on it',
  })
  result!: TripTotalsDto;
}

/** Edits to try against the saved plan without saving them (08, 11, 14). */
export class ValidatePlanDto {
  @ApiPropertyOptional({
    ...editOpsSchema,
    description: 'Edits to try; omitted, the saved plan is validated as it is',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  ops?: unknown[];
}

export class ValidationResultDto {
  @ApiProperty({
    type: [ViolationDto],
    description: 'Every violation of the plan with the edits applied',
  })
  violations!: ViolationDto[];

  @ApiProperty({
    type: [ViolationDto],
    description: 'The ones the edits would cause',
  })
  introduced!: ViolationDto[];
}

export class SuggestFixesDto {
  @ApiProperty({ type: ViolationDto })
  @ValidateNested()
  @Type(() => ViolationDto)
  violation!: ViolationDto;

  @ApiPropertyOptional({
    ...editOpsSchema,
    description: 'Unsaved edits the violation came from (11)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  ops?: unknown[];
}

/** One way out of a violation, ranked: another vehicle, a swap, or deferring an order (10, 11). */
export class FixDto {
  @ApiProperty({ enum: ['MOVE', 'SWAP', 'DEFER'], example: 'MOVE' })
  kind!: 'MOVE' | 'SWAP' | 'DEFER';

  @ApiProperty({ example: 'Move WF-0171 to REF-03 trip 1' })
  label!: string;

  @ApiProperty({
    ...editOpsSchema,
    description: 'Post these to /edits to apply the fix',
  })
  edits!: EditOp[];

  @ApiProperty({
    type: [ViolationDto],
    description: 'Soft violations it would cause; never a hard one',
  })
  introduced!: ViolationDto[];
}

/**
 * Everything the engine needs for this plan, so the web runs the same
 * engine in the browser and validates every edit instantly (AC-PLN-12).
 * `input` is the engine's `EngineInput` and `plan` its `Plan`
 * (packages/engine/src/types.ts); the web types them from @waypoint/engine.
 */
export class PlanContextDto {
  @ApiProperty({ example: '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e' })
  planId!: string;

  @ApiProperty({
    example: 7,
    description: 'The plan version the context was built from',
  })
  version!: number;

  @ApiProperty({ example: '0.3.0' })
  engineVersion!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'EngineInput (packages/engine/src/types.ts)',
  })
  input!: Record<string, unknown>;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Plan: { trips: TripDraft[], unplanned: Unplanned[] }',
  })
  plan!: Record<string, unknown>;
}
