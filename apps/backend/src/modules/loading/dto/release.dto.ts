import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CHECKED_BY_MAX } from './load-check.dto';

/**
 * POST /trips/{id}/release — L4. Online only: the release has to confirm the
 * list is at the plan's latest revision, and only the server knows whether
 * the plan moved while the tablet was away (AC-LOD-17).
 */
export class ReleaseTripDto {
  @ApiPropertyOptional({
    description:
      'The reefer reading in °C; required on a chilled trip, at or below loading.maxReleaseTempC',
    example: 3.4,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-40)
  @Max(60)
  reeferTempC?: number;

  @ApiProperty({ description: 'The name typed on the shared tablet' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CHECKED_BY_MAX)
  checkedByName!: string;

  @ApiProperty({
    description: 'Made on the tablet; the same one twice is one release',
  })
  @IsUUID()
  clientUuid!: string;

  @ApiPropertyOptional({
    description:
      'The revision the tablet is showing; a stale one fails the revision check',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  planRevision?: number;
}

/** The query the dock's boards take: one depot, one business date, one wave. */
export class LoadingBoardQueryDto {
  @ApiPropertyOptional({
    description: 'The business date, Asia/Colombo; today by default',
    example: '2026-10-02',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Expected YYYY-MM-DD' })
  date?: string;

  @ApiPropertyOptional({ description: 'One wave of the day' })
  @IsOptional()
  @IsUUID()
  wave?: string;
}

/** GET /trips/{id}/release-checks takes the reading L4 has so far. */
export class ReleaseChecksQueryDto {
  @ApiPropertyOptional({
    description: 'The reading typed so far, so the list shows live',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-40)
  @Max(60)
  reeferTempC?: number;
}
