import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiLinks } from '../../../core/http/decorators';
import type { Link } from '@waypoint/shared';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** POST /deferral-reasons (A6): a reason dispatchers may give by hand. */
export class CreateDeferralReasonDto {
  @Matches(/^[A-Z][A-Z0-9_]{1,59}$/, {
    message: 'Capital letters, digits and _ only, like STORE_CLOSED',
  })
  @ApiProperty({ example: 'STORE_CLOSED' })
  code!: string;

  @IsString()
  @Length(1, 80)
  @ApiProperty({ example: 'Store closed for a holiday' })
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  @ApiPropertyOptional()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  @ApiPropertyOptional({ example: 50 })
  sortOrder?: number;
}

/** PATCH /deferral-reasons/{code}: engine reasons may be relabelled, never switched off. */
export class UpdateDeferralReasonDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  @ApiPropertyOptional()
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  @ApiPropertyOptional()
  description?: string;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional()
  active?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  @ApiPropertyOptional()
  sortOrder?: number;
}

export class DeferralReasonDto {
  @ApiProperty({ example: 'OVER_CAPACITY' })
  code!: string;

  @ApiProperty({ example: 'Fleet full' })
  label!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'What the store reads on M4; null for a manual reason.',
    example: 'Every suitable vehicle was full for this run.',
  })
  description!: string | null;

  @ApiProperty({
    description: 'Given by the engine; can be relabelled, never switched off',
  })
  fromEngine!: boolean;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({ example: 10 })
  sortOrder!: number;

  @ApiLinks()
  _links!: Record<string, Link>;
}
