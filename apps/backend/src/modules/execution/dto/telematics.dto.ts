import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

/** One GPS fix from the driver's phone (or the demo simulator). */
export class PingDto {
  @ApiProperty({ description: 'The running trip this fix belongs to' })
  @IsUUID()
  tripId!: string;

  @ApiProperty({ example: 7.001 }) @IsNumber() lat!: number;
  @ApiProperty({ example: 79.953 }) @IsNumber() lng!: number;

  @ApiPropertyOptional({ example: 12, nullable: true })
  @IsOptional()
  @IsNumber()
  accuracyM?: number | null;

  @ApiPropertyOptional({ example: 38, nullable: true })
  @IsOptional()
  @IsNumber()
  speedKmh?: number | null;

  @ApiPropertyOptional({ example: 90, nullable: true })
  @IsOptional()
  @IsNumber()
  heading?: number | null;

  @ApiPropertyOptional({ example: 3.5, nullable: true })
  @IsOptional()
  @IsNumber()
  reeferTempC?: number | null;

  @ApiProperty({
    example: '2026-10-02T04:12:05+05:30',
    description:
      'When the phone took the fix, on the server clock it was given',
  })
  @IsISO8601()
  recordedAt!: string;
}

/** POST /telematics/pings: up to 200 fixes; more is 413. */
export class PingBatchDto {
  @ApiProperty({ type: [PingDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PingDto)
  pings!: PingDto[];
}

export class PingResultDto {
  @ApiProperty({ example: 18 }) accepted!: number;
  @ApiProperty({ example: 2 }) duplicates!: number;
  @ApiProperty({ example: 0 }) rejected!: number;
  @ApiProperty({
    type: Object,
    isArray: true,
    description: 'Index in the batch and reason for each refused fix',
    example: [{ index: 3, reason: 'inaccurate' }],
  })
  reasons!: { index: number; reason: string }[];
}

/** One point of 19a's breadcrumb. */
export class TrailPointDto {
  @ApiProperty({ example: 7.001 }) lat!: number;
  @ApiProperty({ example: 79.953 }) lng!: number;
  @ApiProperty({ example: '2026-10-02T04:12:05+05:30' }) recordedAt!: string;
}

export class TripTrailDto {
  @ApiProperty() tripId!: string;
  @ApiProperty({ type: [TrailPointDto] }) points!: TrailPointDto[];
}
