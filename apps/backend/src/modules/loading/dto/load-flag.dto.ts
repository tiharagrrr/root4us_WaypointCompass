import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  LOAD_FLAG_DECISIONS,
  LOAD_FLAG_REASONS,
  type LoadFlagDecision,
  type LoadFlagReason,
} from '@waypoint/shared';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CHECKED_BY_MAX, QTY_MAX } from './load-check.dto';

/** The longest note either dialog takes. */
export const NOTE_MAX = 2000;

/** POST /trips/{id}/load-flags — L3: something is wrong with these goods. */
export class RaiseFlagDto {
  @ApiProperty({ description: 'The line the problem is on' })
  @IsUUID()
  loadLineId!: string;

  @ApiProperty({
    enum: LOAD_FLAG_REASONS,
    description: 'Why: missing, damaged, wrong temperature or over capacity',
  })
  @IsIn(LOAD_FLAG_REASONS)
  reason!: LoadFlagReason;

  @ApiProperty({ description: 'How much is affected', minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(QTY_MAX)
  qtyAffected!: number;

  @ApiPropertyOptional({ description: 'What the loader saw' })
  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;

  @ApiProperty({ description: 'The name typed on the shared tablet' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CHECKED_BY_MAX)
  raisedByName!: string;

  @ApiProperty({ description: 'Made on the tablet; a replay is a duplicate' })
  @IsUUID()
  clientUuid!: string;

  @ApiPropertyOptional({
    description: 'A photo queued with the flag, by its own clientUuid',
  })
  @IsOptional()
  @IsUUID()
  photoClientUuid?: string;

  @ApiPropertyOptional({ description: 'The tablet this came from' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceId?: string;
}

/**
 * POST /load-flags/{id}/decision — L3b: the dispatcher's answer. REPLACE
 * sends the loader back for another crate; REMOVE accepts the goods are not
 * travelling, which needs a reason the store can be told (AC-LOD-08).
 */
export class DecideFlagDto {
  @ApiProperty({ enum: LOAD_FLAG_DECISIONS })
  @IsIn(LOAD_FLAG_DECISIONS)
  decision!: LoadFlagDecision;

  @ApiPropertyOptional({
    description: 'A code from /deferral-reasons; required on REMOVE',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  reasonCode?: string;

  @ApiPropertyOptional({ description: 'What the loader should do about it' })
  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;
}

/** POST /load-flags/{id}/recheck — L3c: the replacement is on the vehicle. */
export class RecheckFlagDto {
  @ApiProperty({ description: 'What is on the pallet now', minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(QTY_MAX)
  qtyLoaded!: number;

  @ApiProperty({ description: 'The name typed on the shared tablet' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CHECKED_BY_MAX)
  checkedByName!: string;

  @ApiProperty({ description: 'Made on the tablet; a replay is a duplicate' })
  @IsUUID()
  clientUuid!: string;
}
