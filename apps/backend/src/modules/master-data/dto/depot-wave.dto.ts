import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BRANDS, type Brand, type Link } from '@waypoint/shared';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';

const MINUTE_OF_DAY = { min: 0, max: 1439 } as const;

/** A departure band at a depot ("Run 1", 05:15 to 06:30), as A4 lists it. */
export class DepotWaveDto {
  @ApiProperty({ example: '0192f0c7-0000-7000-8000-000000000000' })
  id!: string;

  @ApiProperty({ example: 'PLG' })
  depotId!: string;

  @ApiProperty({ example: 'Run 1' })
  label!: string;

  @ApiProperty({ description: 'Minutes after midnight', example: 315 })
  departFromMin!: number;

  @ApiProperty({ example: '05:15' })
  departFrom!: string;

  @ApiProperty({ example: 390 })
  departToMin!: number;

  @ApiProperty({ example: '06:30' })
  departTo!: string;

  @ApiProperty({
    enum: BRANDS,
    enumName: 'Brand',
    isArray: true,
    example: ['FRESH'],
  })
  brands!: Brand[];

  @ApiLinks()
  _links!: Record<string, Link>;
}

/** POST /depots/{id}/waves (A4): one label per depot (AC-MD-07). */
export class CreateDepotWaveDto {
  @IsString()
  @Length(1, 40)
  @ApiProperty({ example: 'Run 1' })
  label!: string;

  @IsInt()
  @Min(MINUTE_OF_DAY.min)
  @Max(MINUTE_OF_DAY.max)
  @ApiProperty({ example: 315, minimum: 0, maximum: 1439 })
  departFromMin!: number;

  @IsInt()
  @Min(MINUTE_OF_DAY.min)
  @Max(MINUTE_OF_DAY.max)
  @ApiProperty({ example: 390, minimum: 0, maximum: 1439 })
  departToMin!: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsIn(BRANDS, { each: true })
  @ApiProperty({ enum: BRANDS, enumName: 'Brand', isArray: true })
  brands!: Brand[];
}

/** PATCH /depots/{id}/waves/{waveId}: the band, its label or its brands. */
export class UpdateDepotWaveDto {
  @IsOptional()
  @IsString()
  @Length(1, 40)
  @ApiPropertyOptional({ example: 'Run 2' })
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(MINUTE_OF_DAY.min)
  @Max(MINUTE_OF_DAY.max)
  @ApiPropertyOptional({ example: 660 })
  departFromMin?: number;

  @IsOptional()
  @IsInt()
  @Min(MINUTE_OF_DAY.min)
  @Max(MINUTE_OF_DAY.max)
  @ApiPropertyOptional({ example: 750 })
  departToMin?: number;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(BRANDS, { each: true })
  @ApiPropertyOptional({ enum: BRANDS, enumName: 'Brand', isArray: true })
  brands?: Brand[];
}
