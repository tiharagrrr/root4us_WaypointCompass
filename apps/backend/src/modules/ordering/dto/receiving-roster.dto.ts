import { ApiProperty } from '@nestjs/swagger';
import type { Link } from '@waypoint/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Who takes a delivery at an outlet, and between which hours (M3). */
export class ReceivingRosterEntryDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000d001' })
  id!: string;

  @ApiProperty({ example: 'Nadeesha' })
  staffName!: string;

  @ApiProperty({ description: 'Minutes after midnight', example: 420 })
  fromMin!: number;

  @ApiProperty({ example: '07:00' })
  from!: string;

  @ApiProperty({ example: 540 })
  toMin!: number;

  @ApiProperty({ example: '09:00' })
  to!: string;
}

/** The whole roster for one outlet and date; PUT replaces it. */
export class ReceivingRosterDto {
  @ApiProperty({ example: 'OUT014' })
  outletId!: string;

  @ApiProperty({ example: '2026-10-02' })
  date!: string;

  @ApiProperty({ type: [ReceivingRosterEntryDto] })
  entries!: ReceivingRosterEntryDto[];

  @ApiLinks()
  _links!: Record<string, Link>;
}

/** One band in a PUT: a name and the minutes they cover. */
export class ReceivingRosterEntryInputDto {
  @IsString()
  @Length(1, 120)
  @ApiProperty({ example: 'Nadeesha' })
  staffName!: string;

  @IsInt()
  @Min(0)
  @Max(1439)
  @ApiProperty({ example: 420, minimum: 0, maximum: 1439 })
  fromMin!: number;

  @IsInt()
  @Min(1)
  @Max(1440)
  @ApiProperty({ example: 540, minimum: 1, maximum: 1440 })
  toMin!: number;
}

/** PUT /outlets/{id}/receiving-roster?date=: the day's whole roster. */
export class SetReceivingRosterDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReceivingRosterEntryInputDto)
  @ApiProperty({ type: [ReceivingRosterEntryInputDto] })
  entries!: ReceivingRosterEntryInputDto[];
}

/** ?date=2026-10-02: which day's roster to read or replace. */
export class RosterDateQueryDto {
  @Matches(BUSINESS_DATE, { message: 'Use a date as YYYY-MM-DD' })
  @ApiProperty({ example: '2026-10-02' })
  date!: string;
}
