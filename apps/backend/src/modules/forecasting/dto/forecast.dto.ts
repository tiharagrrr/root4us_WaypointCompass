import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Link } from '@waypoint/shared';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';
import { BRANDS, type Brand } from '../domain/weekly-forecast';

const SOURCES = ['BASELINE', 'DATATHON'] as const;

/** The most weeks one request may ask for: half a year. */
export const MAX_WEEKS = 26;

export class ForecastQueryDto {
  @ApiPropertyOptional({
    description: 'How many ISO weeks after the current one',
    example: 10,
    default: 10,
    minimum: 1,
    maximum: MAX_WEEKS,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_WEEKS)
  weeks?: number;

  @ApiPropertyOptional({
    enum: BRANDS,
    description: 'One brand’s volume; every brand when left out',
  })
  @IsOptional()
  @IsIn(BRANDS)
  brand?: Brand;
}

/** The vehicles that can run today and the depot's drivers. */
export class ForecastFleetDto {
  @ApiProperty({ example: 17, description: 'Active vehicles at the depot' })
  vehicles!: number;

  @ApiProperty({ example: 8, description: 'Active reefers among them' })
  reefers!: number;

  @ApiProperty({ example: 17, description: 'Active drivers at the depot' })
  drivers!: number;

  @ApiProperty({
    example: 208,
    description: 'Summed load volume of the active vehicles, m³, one trip each',
  })
  volumeCapM3!: number;

  @ApiProperty({ example: 96, description: 'The same for the reefers alone' })
  reeferVolumeCapM3!: number;
}

export class ForecastBrandDto {
  @ApiProperty({ enum: BRANDS, example: 'FRESH' })
  brand!: Brand;

  @ApiProperty({ example: 71.4 })
  totalVolumeM3!: number;

  @ApiProperty({ example: 49, description: '0 for Style and Tech' })
  chilledVolumeM3!: number;

  @ApiProperty({
    enum: SOURCES,
    example: 'DATATHON',
    description:
      'DATATHON when imported; BASELINE when worked out from order history',
  })
  source!: (typeof SOURCES)[number];
}

/** One ISO week of 22's chart. */
export class ForecastWeekDto {
  @ApiProperty({ example: 2026 })
  isoYear!: number;

  @ApiProperty({ example: 44 })
  isoWeek!: number;

  @ApiProperty({ example: '2026-10-26', description: 'The week’s Monday' })
  weekStart!: string;

  @ApiProperty({ example: 6 })
  operatingDays!: number;

  @ApiProperty({ example: 111 })
  totalVolumeM3!: number;

  @ApiProperty({ example: 49 })
  chilledVolumeM3!: number;

  @ApiProperty({ example: 62 })
  ambientVolumeM3!: number;

  @ApiProperty({
    example: 104,
    description:
      'What the active fleet can move in the week: each vehicle’s volume, for the trips it may run a day, on each operating day',
  })
  capacityM3!: number;

  @ApiProperty({ example: 48, description: 'The same over the reefers' })
  chilledCapacityM3!: number;

  @ApiProperty({
    example: true,
    description: 'The volume passes the capacity, in total or in chilled',
  })
  overCapacity!: boolean;

  @ApiProperty({ example: 7, description: 'Volume past capacityM3, or 0' })
  gapVolumeM3!: number;

  @ApiProperty({ example: 1 })
  chilledGapVolumeM3!: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 1,
    description:
      'More reefers needed to carry the chilled gap; null with no fleet to size them by',
  })
  extraReefers!: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 0,
    description: 'More vehicles needed once those reefers are added',
  })
  extraVehicles!: number | null;

  @ApiProperty({ example: true, description: 'A payday falls in the week' })
  payday!: boolean;

  @ApiProperty({ type: [String], example: ['Deepavali'] })
  festivals!: string[];

  @ApiProperty({ example: false })
  monsoon!: boolean;

  @ApiProperty({ type: [ForecastBrandDto] })
  brands!: ForecastBrandDto[];
}

/** The weeks ahead for one depot against its fleet (22, and 12 reads it too). */
export class DepotForecastDto {
  @ApiProperty({ example: 'PLG' })
  depotId!: string;

  @ApiProperty({
    enum: BRANDS,
    nullable: true,
    example: null,
    description: 'The brand asked for; null for every brand',
  })
  brand!: Brand | null;

  @ApiProperty({ type: ForecastFleetDto })
  fleet!: ForecastFleetDto;

  @ApiProperty({ example: 3, description: 'Weeks flagged over capacity' })
  gapWeeks!: number;

  @ApiProperty({ type: [ForecastWeekDto] })
  weeks!: ForecastWeekDto[];

  @ApiLinks()
  _links!: Record<string, Link>;
}
