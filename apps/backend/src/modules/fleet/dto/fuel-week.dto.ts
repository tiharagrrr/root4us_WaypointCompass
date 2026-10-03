import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';
import type { Link } from '@waypoint/shared';
import { ApiLinks } from '../../../core/http/decorators';

export class FuelWeekQueryDto {
  @ApiPropertyOptional({
    description: 'ISO week as YYYY-Www; defaults to the current business week',
    example: '2026-W40',
  })
  @IsOptional()
  @Matches(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/, {
    message: 'week must be an ISO week such as 2026-W40',
  })
  week?: string;
}

/** A vehicle's fuel for one ISO week, against its weekly quota (A5, 06). */
export class FuelWeekDto {
  @ApiProperty({ example: 'VEH014' })
  vehicleId!: string;

  @ApiProperty({ example: 2026 })
  isoYear!: number;

  @ApiProperty({ example: 40 })
  isoWeek!: number;

  @ApiProperty({ example: 400, description: 'Weekly fuel quota, litres' })
  quotaL!: number;

  @ApiProperty({
    example: 120,
    description: 'Planned litres still standing (reversals are subtracted)',
  })
  plannedL!: number;

  @ApiProperty({ example: 46.5, description: 'Litres recorded at close' })
  actualL!: number;

  @ApiProperty({ example: 0 })
  adjustmentL!: number;

  @ApiProperty({
    example: 166.5,
    description: 'Everything counted against the quota',
  })
  usedL!: number;

  @ApiProperty({
    example: 233.5,
    description: 'quotaL minus usedL; negative when over',
  })
  leftL!: number;

  @ApiLinks()
  _links!: Record<string, Link>;
}
