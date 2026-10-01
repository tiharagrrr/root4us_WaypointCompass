import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiLinks } from '../../../core/http/decorators';
import type { Link } from '@waypoint/shared';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

const INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** ?depotId=PLG: resolve, set or clear that depot's override. */
export class SettingScopeQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 40)
  @ApiPropertyOptional({ example: 'PLG' })
  depotId?: string;
}

/** PUT /settings/{key}: any JSON value the key's schema accepts. */
export class SetSettingDto {
  @IsDefined()
  @ApiProperty({
    description: "A value the key's schema accepts",
    oneOf: [
      { type: 'number' },
      { type: 'string' },
      { type: 'boolean' },
      { type: 'object' },
    ],
    example: 945,
  })
  value!: unknown;
}

export const SETTING_SOURCES = ['default', 'global', 'depot'] as const;

/** A setting on A6, resolved for the caller's depot when one was asked for. */
export class SettingDto {
  @ApiProperty({ example: 'ordering.cutoffReminderMin' })
  key!: string;

  @ApiProperty({
    description: 'The resolved value (JSON)',
    oneOf: [
      { type: 'number' },
      { type: 'string' },
      { type: 'boolean' },
      { type: 'object' },
    ],
    example: 930,
  })
  value!: unknown;

  @ApiProperty({
    description: "The registry's default (JSON)",
    oneOf: [
      { type: 'number' },
      { type: 'string' },
      { type: 'boolean' },
      { type: 'object' },
    ],
    example: 930,
  })
  default!: unknown;

  @ApiProperty({ enum: SETTING_SOURCES, enumName: 'SettingSource' })
  source!: (typeof SETTING_SOURCES)[number];

  @ApiProperty({ nullable: true, type: String, example: null })
  depotId!: string | null;

  @ApiProperty({ description: 'A depot may override it' })
  perDepot!: boolean;

  @ApiProperty({
    description: 'Changed on A6 (not by the clock or the system)',
  })
  editable!: boolean;

  @ApiProperty({ example: 'When outlets with no order get a reminder' })
  description!: string;

  @ApiProperty({ nullable: true, type: String })
  updatedAt!: string | null;

  @ApiLinks()
  _links!: Record<string, Link>;
}

export const SETTABLE_CLOCK_MODES = ['real', 'offset', 'frozen'] as const;

/**
 * PUT /clock (A6 time travel, demo mode only): back to real; offset by
 * offsetMs, or to run on from `at`; frozen at `at`.
 */
export class SetClockDto {
  @IsIn(SETTABLE_CLOCK_MODES)
  @ApiProperty({ enum: SETTABLE_CLOCK_MODES, enumName: 'SettableClockMode' })
  mode!: (typeof SETTABLE_CLOCK_MODES)[number];

  @IsOptional()
  @Matches(INSTANT, { message: 'Use ISO 8601 with an offset' })
  @ApiPropertyOptional({ example: '2026-10-01T15:55:00+05:30' })
  at?: string;

  @IsOptional()
  @IsInt()
  @ApiPropertyOptional({ example: 3_600_000 })
  offsetMs?: number;
}

export class ClockDto {
  @ApiProperty({ enum: ['real', 'offset', 'frozen', 'simulated'] })
  mode!: string;

  @ApiProperty({ example: '2026-10-01T15:55:00+05:30' })
  now!: string;

  @ApiProperty({ example: '2026-10-01T09:12:44+05:30' })
  realNow!: string;

  @ApiProperty({ nullable: true, type: String })
  at!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  offsetMs!: number | null;

  @ApiProperty({
    description: 'DEMO_MODE=true: time travel and the demo tools exist',
  })
  demoMode!: boolean;

  @ApiProperty({ description: 'The header shows a demo-time badge' })
  shifted!: boolean;

  @ApiLinks()
  _links!: Record<string, Link>;
}

export class DemoResetDto {
  @ApiProperty({ example: ['2026-10-01', '2026-10-02', '2026-10-03'] })
  days!: string[];

  @ApiProperty({ type: Object, isArray: true })
  rebuilt!: { builder: string; deleted: number; created: number }[];
}
