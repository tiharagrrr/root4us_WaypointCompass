import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Link } from '@waypoint/shared';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';
import {
  DEFAULT_SPEED,
  INJECTION_KINDS,
  SCENARIOS,
  type InjectionKind,
  type Scenario,
} from '../simulation.constants';

/** POST /simulations: a run of a scenario on a published plan, or a replay of an earlier run. */
export class CreateSimulationDto {
  @IsOptional()
  @IsIn(SCENARIOS)
  @ApiPropertyOptional({ enum: SCENARIOS, example: 'normal-day' })
  scenario?: Scenario;

  @ValidateIf((dto: CreateSimulationDto) => !dto.replayOf)
  @IsUUID()
  @ApiPropertyOptional({
    description: 'The published plan to run; required unless replayOf is given',
    example: '0192a3f4-0000-7000-8000-00000000b001',
  })
  planId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  @ApiPropertyOptional({ example: 42 })
  seed?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(600)
  @ApiPropertyOptional({
    description: 'Simulated seconds per real second',
    example: DEFAULT_SPEED,
  })
  speed?: number;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    description:
      'Let the AI scenario director add trouble; refused unless the collection carries the director link',
    example: false,
  })
  agentic?: boolean;

  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({
    description:
      'Replay this run: its scenario, plan, seed, speed and stored injections, with no model call',
    example: '0192a3f4-0000-7000-8000-00000000c001',
  })
  replayOf?: string;
}

/** POST /simulations/{id}/injections: trouble at a simulated time. */
export class CreateInjectionDto {
  @IsIn(INJECTION_KINDS)
  @ApiProperty({ enum: INJECTION_KINDS, example: 'ROAD_DELAY' })
  kind!: InjectionKind;

  @IsISO8601({ strict: true })
  @ApiProperty({ example: '2026-10-02T06:00:00+05:30' })
  atSim!: string;

  @IsObject()
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'ROAD_DELAY: { districtId }. FAILED_DELIVERY: { stopId }.',
    example: { districtId: 'kandy' },
  })
  target!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'ROAD_DELAY: { speedIndex (10 to 100), minutes }. FAILED_DELIVERY: { reason: REFUSED | DAMAGED | OUTLET_CLOSED }.',
    example: { speedIndex: 55, minutes: 60 },
  })
  params?: Record<string, unknown>;
}

export class InjectionDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000e001' })
  id!: string;

  @ApiProperty({ example: 'ROAD_DELAY' })
  kind!: string;

  @ApiProperty({ example: '2026-10-02T06:00:00+05:30' })
  atSim!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  target!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  params!: Record<string, unknown> | null;

  @ApiProperty({ enum: ['human', 'agent'], example: 'human' })
  proposedBy!: string;

  @ApiProperty({ nullable: true, type: String, example: null })
  firedAt!: string | null;
}

/** A simulation run, with its trouble and what the caller may do next. */
export class SimulationDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000c001' })
  id!: string;

  @ApiProperty({ example: 'normal-day' })
  scenario!: string;

  @ApiProperty({
    enum: ['DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED'],
    example: 'RUNNING',
  })
  status!: string;

  @ApiProperty({ nullable: true, type: String })
  planId!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'PLG' })
  depotId!: string | null;

  @ApiProperty({ nullable: true, type: String, example: '2026-10-02' })
  planDate!: string | null;

  @ApiProperty({ example: 42 })
  seed!: number;

  @ApiProperty({ example: 60 })
  speed!: number;

  @ApiProperty({ example: '2026-10-02T03:20:00+05:30' })
  simStartAt!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T05:30:00+05:30',
  })
  simNow!: string | null;

  @ApiProperty({ description: 'The AI scenario director may add trouble' })
  agentic!: boolean;

  @ApiProperty({ nullable: true, type: String })
  narrative!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: {
      stopsDelivered: 12,
      stopsFailed: 1,
      tripsCompleted: 2,
      injections: 1,
    },
  })
  kpis!: Record<string, unknown> | null;

  @ApiProperty({ type: [InjectionDto] })
  injections!: InjectionDto[];

  @ApiProperty({ example: '2026-10-04T10:00:00+05:30' })
  createdAt!: string;

  @ApiProperty({ nullable: true, type: String })
  finishedAt!: string | null;

  @ApiLinks()
  _links!: Record<string, Link>;
}
