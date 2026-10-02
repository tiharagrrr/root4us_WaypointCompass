import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DEPOT_KINDS, type DepotKind, type Link } from '@waypoint/shared';
import { IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';

/** A depot as A4 shows it: docks, chilled docks and the cutoff override. */
export class DepotDto {
  @ApiProperty({ example: 'PLG' })
  id!: string;

  @ApiProperty({ example: 'Peliyagoda' })
  name!: string;

  @ApiProperty({
    enum: DEPOT_KINDS,
    enumName: 'DepotKind',
    example: 'CENTRAL',
  })
  kind!: DepotKind;

  @ApiProperty({ nullable: true, type: String, example: null })
  address!: string | null;

  @ApiProperty({ nullable: true, type: Number, example: 6.9654 })
  lat!: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 79.8871 })
  lng!: number | null;

  @ApiProperty({ example: 6 })
  dockCount!: number;

  @ApiProperty({ example: 2 })
  chilledDocks!: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Overrides ordering.cutoffMin for this depot; 900 is 15:00',
    example: null,
  })
  cutoffMin!: number | null;

  @ApiProperty({
    description: 'The cutoff in force here, from the depot or the setting',
    example: 960,
  })
  effectiveCutoffMin!: number;

  @ApiProperty({ example: '16:00' })
  effectiveCutoff!: string;

  @ApiLinks()
  _links!: Record<string, Link>;
}

/** PATCH /depots/{id} (A4): docks and the cutoff override. */
export class UpdateDepotDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @ApiPropertyOptional({ example: 6 })
  dockCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @ApiPropertyOptional({ example: 3 })
  chilledDocks?: number;

  @IsOptional()
  @ValidateIf((d: UpdateDepotDto) => d.cutoffMin !== null)
  @IsInt()
  @Min(0)
  @Max(1439)
  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'null removes the override',
    example: 900,
  })
  cutoffMin?: number | null;
}
