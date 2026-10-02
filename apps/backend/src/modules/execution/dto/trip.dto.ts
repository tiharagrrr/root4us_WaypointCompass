import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BRANDS,
  type Brand,
  CANT_RUN_REASONS,
  type CantRunReason,
  type Link,
  TEMP_CLASSES,
  type TempClass,
  TRIP_STATUSES,
  type TripStatus,
} from '@waypoint/shared';
import {
  IsISO8601,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class TripVehicleDto {
  @ApiProperty({ example: 'REF-07' })
  id!: string;

  @ApiProperty({ example: 'REF-07' })
  code!: string;

  @ApiProperty({ enum: ['AMBIENT', 'REEFER'], example: 'REEFER' })
  temp!: 'AMBIENT' | 'REEFER';
}

/** A trip on D1 (today), D10 (the last 7 days) and D14 (nothing today). */
export class TripSummaryDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000b001' })
  id!: string;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'The first or second run of the day for this vehicle',
    example: 1,
  })
  tripNo!: number | null;

  @ApiProperty({ enum: TRIP_STATUSES, example: 'RELEASED' })
  status!: TripStatus;

  @ApiProperty({
    description: 'Business date, Asia/Colombo',
    example: '2026-10-02',
  })
  date!: string;

  @ApiProperty({ example: 'PLG' })
  depotId!: string;

  @ApiProperty({ enum: BRANDS, example: 'FRESH' })
  brand!: Brand;

  @ApiProperty({ enum: TEMP_CLASSES, example: 'CHILLED' })
  tempClass!: TempClass;

  @ApiProperty({ type: TripVehicleDto })
  vehicle!: TripVehicleDto;

  @ApiProperty({ description: 'Stops still on the trip', example: 6 })
  stops!: number;

  @ApiProperty({
    description: 'Stops with nothing recorded yet',
    example: 6,
  })
  openStops!: number;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T03:30:00+05:30',
  })
  plannedDepartAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T02:30:00+05:30',
  })
  releasedAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'When the phone last saved the offline bundle',
    example: null,
  })
  downloadedAt!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  startedAt!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  completedAt!: string | null;

  @ApiProperty({
    nullable: true,
    enum: CANT_RUN_REASONS,
    description: "Set once the driver said she can't run it (D8)",
    example: null,
  })
  cantRunReason!: CantRunReason | null;

  @ApiProperty({ example: 1 })
  version!: number;

  @ApiLinks()
  _links!: Record<string, Link>;
}

/**
 * Every field write a driver sends carries the clientUuid the phone made and
 * the device time it happened at, so an online tap and the same tap replayed
 * from the outbox after a tunnel are one event, recorded once
 * (specs/execution/spec.md, Endpoints; specs/sync/spec.md).
 */
export class FieldEventDto {
  @ApiProperty({
    description:
      'Made on the phone; a replay with the same value changes nothing',
    example: '0192a3f4-0000-7000-8000-00000000c001',
  })
  @IsUUID()
  clientUuid!: string;

  @ApiProperty({
    description: 'The device clock, aligned to the server clock',
    example: '2026-10-02T03:40:00+05:30',
  })
  @IsISO8601({ strict: true })
  occurredAt!: string;

  @ApiPropertyOptional({
    description: 'Creation order on the device',
    example: 11,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  deviceSeq?: number;

  @ApiPropertyOptional({ example: 'pwa-aniqa-pixel-7' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  deviceId?: string;

  @ApiPropertyOptional({
    description: 'The stop or trip version the phone saw when it recorded this',
    example: 3,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  baseVersion?: number;

  @ApiPropertyOptional({ example: 6.9271 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ example: 79.8612 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;
}

/** D1 Start trip: a chilled or frozen run also reports the reefer temperature. */
export class StartTripDto extends FieldEventDto {
  @ApiPropertyOptional({
    description: 'Required on a CHILLED trip (°C)',
    example: 3.4,
  })
  @IsOptional()
  @IsNumber()
  @Min(-30)
  @Max(30)
  reeferTempC?: number;
}

/** D2 Downloaded: which bundle the phone now holds. */
export class TripDownloadedDto extends FieldEventDto {
  @ApiProperty({
    description: 'Which version of the bundle the phone holds',
    example: 3,
  })
  @IsNumber()
  @Min(1)
  bundleVersion!: number;

  @ApiProperty({
    description: 'The bundle hash, so a stale download is visible',
    example: '9f2b1c…',
  })
  @IsString()
  @Length(8, 128)
  bundleHash!: string;
}

/** D8 Can't run this trip. */
export class CantRunDto extends FieldEventDto {
  @ApiProperty({ enum: CANT_RUN_REASONS, example: 'BREAKDOWN' })
  @IsIn(CANT_RUN_REASONS)
  reasonCode!: CantRunReason;

  @ApiProperty({ example: 'Compressor stopped at Peliyagoda' })
  @IsString()
  @Length(1, 2000)
  note!: string;

  @ApiPropertyOptional({
    description: 'Photo attachments by their own clientUuid',
    type: [String],
  })
  @IsOptional()
  @IsUUID('all', { each: true })
  attachmentUuids?: string[];
}

export class TripDateQueryDto {
  @ApiPropertyOptional({
    description: 'One business date; omitted, the last 7 days (D10)',
    example: '2026-10-02',
  })
  @IsOptional()
  @IsString()
  @Matches(BUSINESS_DATE, { message: 'Use a date like 2026-10-02' })
  date?: string;
}
