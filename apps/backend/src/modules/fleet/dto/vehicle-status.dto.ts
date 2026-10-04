import { ApiProperty } from '@nestjs/swagger';
import type { Link } from '@waypoint/shared';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';

export const VEHICLE_STATUSES = ['ACTIVE', 'WORKSHOP', 'BREAKDOWN'] as const;

/** PUT /vehicles/{id}/status: a status with the reason for it (AC-FLT-05). */
export class SetVehicleStatusDto {
  @ApiProperty({ enum: VEHICLE_STATUSES, example: 'BREAKDOWN' })
  @IsIn(VEHICLE_STATUSES)
  status!: (typeof VEHICLE_STATUSES)[number];

  @ApiProperty({ example: 'Compressor fault', description: 'Required' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/** A vehicle's status as the status change answers it. */
export class VehicleStatusDto {
  @ApiProperty({ example: 'VEH007' })
  id!: string;

  @ApiProperty({ example: 'REF-07' })
  code!: string;

  @ApiProperty({ example: 'PLG' })
  depotId!: string;

  @ApiProperty({ enum: VEHICLE_STATUSES, example: 'BREAKDOWN' })
  status!: string;

  @ApiProperty({ nullable: true, type: String, example: 'Compressor fault' })
  statusReason!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T04:40:00+05:30',
  })
  statusChangedAt!: string | null;

  @ApiProperty({ example: 4 })
  version!: number;

  /** self, status (PUT, If-Match). */
  @ApiLinks()
  _links!: Record<string, Link>;
}
