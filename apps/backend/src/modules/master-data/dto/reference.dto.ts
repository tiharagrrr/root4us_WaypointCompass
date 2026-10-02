import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BRANDS,
  type Brand,
  DOCK_TYPES,
  type DockType,
  type Link,
  ROAD_CLASSES,
  type RoadClass,
} from '@waypoint/shared';
import { IsOptional, Matches } from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A district with the travel figures the engine plans on. */
export class DistrictDto {
  @ApiProperty({ example: 'gampaha' })
  id!: string;

  @ApiProperty({ example: 'Gampaha' })
  name!: string;

  @ApiProperty({ nullable: true, type: String, example: 'Western' })
  province!: string | null;

  @ApiProperty({ example: 'PLG' })
  depotId!: string;

  @ApiProperty({ enum: ROAD_CLASSES, enumName: 'RoadClass', example: 'URBAN' })
  roadClass!: RoadClass;

  @ApiProperty({ example: 30 })
  freeFlowKmh!: number;

  @ApiProperty({ example: 20 })
  depotToDistrictKm!: number;

  @ApiProperty({ example: 37 })
  depotToDistrictMin!: number;

  @ApiProperty({ example: 4 })
  interStopKm!: number;

  @ApiProperty({ example: 9 })
  interStopMin!: number;

  @ApiProperty({ nullable: true, type: Number, example: 7.0912 })
  centroidLat!: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 79.9999 })
  centroidLng!: number | null;

  @ApiLinks()
  _links!: Record<string, Link>;
}

/** One day of the calendar, as date pickers and the cutoff read it. */
export class CalendarDayDto {
  @ApiProperty({ example: '2026-10-02' })
  date!: string;

  @ApiProperty({ description: '0 = Monday', example: 4 })
  dow!: number;

  @ApiProperty({ example: false })
  isWeekend!: boolean;

  @ApiProperty({ example: 2026 })
  isoYear!: number;

  @ApiProperty({ example: 40 })
  isoWeek!: number;

  @ApiProperty({ example: false })
  isPayday!: boolean;

  @ApiProperty({ nullable: true, type: String, example: null })
  festival!: string | null;

  @ApiProperty({ example: 1 })
  festivalRamp!: number;

  @ApiProperty({ example: false })
  isHoliday!: boolean;

  @ApiProperty({ example: false })
  monsoon!: boolean;

  @ApiProperty({
    description: 'Orders may be delivered on this day',
    example: true,
  })
  isOperating!: boolean;
}

/** GET /calendar?from=&to=: both ends are business dates and inclusive. */
export class CalendarRangeQueryDto {
  @IsOptional()
  @Matches(BUSINESS_DATE, { message: 'Use a date as YYYY-MM-DD' })
  @ApiPropertyOptional({ example: '2026-09-30' })
  from?: string;

  @IsOptional()
  @Matches(BUSINESS_DATE, { message: 'Use a date as YYYY-MM-DD' })
  @ApiPropertyOptional({ example: '2026-10-04' })
  to?: string;
}

/** How long a stop takes, by brand and dock type. */
export class ServiceAllowanceDto {
  @ApiProperty({ enum: BRANDS, enumName: 'Brand', example: 'FRESH' })
  brand!: Brand;

  @ApiProperty({ enum: DOCK_TYPES, enumName: 'DockType', example: 'REAR_DOCK' })
  dockType!: DockType;

  @ApiProperty({ description: 'Minutes at the stop', example: 18 })
  minutes!: number;
}

/** The hourly speed index of a district; 100 is free flow. */
export class TrafficSpeedDto {
  @ApiProperty({ example: 'gampaha' })
  districtId!: string;

  @ApiProperty({ example: 7 })
  hour!: number;

  @ApiProperty({ example: false })
  monsoon!: boolean;

  @ApiProperty({ example: 72 })
  speedIndex!: number;
}

/** A day's road disruption in a district; 100 is clear. */
export class RoadConditionDto {
  @ApiProperty({ example: '2026-10-02' })
  date!: string;

  @ApiProperty({ example: 'gampaha' })
  districtId!: string;

  @ApiProperty({ example: 92 })
  disruptionIndex!: number;
}
