import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_CHECK_BATCH } from '../loading.constants';

/** The longest name the Checked by field takes. */
export const CHECKED_BY_MAX = 120;
/** Nothing on a pallet runs to five figures; a typo should not pass. */
export const QTY_MAX = 9999;

/** One line checked, as L2 sends it and as the outbox replays it. */
export class LoadCheckItemDto {
  @ApiProperty({ description: 'The load line being checked' })
  @IsUUID()
  lineId!: string;

  @ApiProperty({
    description: 'What is on the pallet; must equal qtyExpected',
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  @Max(QTY_MAX)
  qtyLoaded!: number;

  @ApiProperty({
    description: 'The name typed on the shared tablet, e.g. "Harini De Mel"',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CHECKED_BY_MAX)
  checkedByName!: string;

  @ApiProperty({ description: 'Made on the tablet; a replay is a duplicate' })
  @IsUUID()
  clientUuid!: string;

  @ApiProperty({
    description: 'The device clock, ISO 8601 with an offset',
    example: '2026-10-02T02:45:10+05:30',
  })
  @IsISO8601({ strict: true })
  checkedAt!: string;

  @ApiPropertyOptional({
    description: 'Creation order on the device; a batch applies in this order',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  deviceSeq?: number;

  @ApiPropertyOptional({ description: 'The tablet this came from' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceId?: string;
}

/**
 * POST /trips/{id}/load-list/checks: a batch of checks. The same body
 * arrives through POST /sync after a spell with no signal, which is why
 * every item carries its own `clientUuid` and device time.
 */
export class LoadCheckBatchDto {
  @ApiProperty({ type: [LoadCheckItemDto], maxItems: MAX_CHECK_BATCH })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CHECK_BATCH)
  @ValidateNested({ each: true })
  @Type(() => LoadCheckItemDto)
  checks!: LoadCheckItemDto[];
}

/** POST /load-lines/{id}/undo: who took the check back. */
export class UndoCheckDto {
  @ApiPropertyOptional({ description: 'The name typed on the shared tablet' })
  @IsOptional()
  @IsString()
  @MaxLength(CHECKED_BY_MAX)
  checkedByName?: string;
}
