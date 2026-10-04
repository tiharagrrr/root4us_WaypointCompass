import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  type Link,
  VEHICLE_STATUSES,
  VEHICLE_TEMPS,
  type VehicleStatus,
  type VehicleTemp,
  VEHICLE_TYPES,
  type VehicleType,
} from '@waypoint/shared';
import {
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';

/** The driver a vehicle is the usual ride of (A5, from `users.defaultVehicleId`). */
export class VehicleDriverDto {
  @ApiProperty({ example: 'user_01J9' })
  id!: string;

  @ApiProperty({ example: 'Aniqa Razick' })
  name!: string;
}

/** One vehicle as A5 lists and reads it, and as 06 and 09 show its card. */
export class VehicleDto {
  @ApiProperty({ example: 'VEH007' })
  id!: string;

  @ApiProperty({ example: 'REF-07' })
  code!: string;

  @ApiProperty({ example: 'WP-REF-07' })
  registrationNo!: string;

  @ApiProperty({ enum: VEHICLE_TYPES, enumName: 'VehicleType' })
  type!: VehicleType;

  @ApiProperty({ enum: VEHICLE_TEMPS, enumName: 'VehicleTemp' })
  temp!: VehicleTemp;

  @ApiProperty({ example: 3000 })
  weightCapKg!: number;

  @ApiProperty({ example: 20 })
  volumeCapM3!: number;

  @ApiProperty({ example: 'diesel' })
  fuelType!: string;

  @ApiProperty({ example: 6 })
  kmPerL!: number;

  @ApiProperty({ example: 400 })
  weeklyFuelQuotaL!: number;

  @ApiProperty({ example: 'PLG' })
  depotId!: string;

  @ApiProperty({ enum: VEHICLE_STATUSES, enumName: 'VehicleStatus' })
  status!: VehicleStatus;

  @ApiProperty({ nullable: true, type: String, example: null })
  statusReason!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  statusChangedAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: VehicleDriverDto,
    description: 'The driver linked to this vehicle; null when none is',
  })
  driver!: VehicleDriverDto | null;

  @ApiProperty({ example: 4, description: 'Send back as If-Match on a write' })
  version!: number;

  @ApiLinks()
  _links!: Record<string, Link>;
}

/**
 * PATCH /vehicles/{id} (A5): the vehicle's own details. Its status goes
 * through PUT /vehicles/{id}/status with a reason, and its home depot stays
 * put, because trips point at the pair (AC-FLT-07).
 */
export class UpdateVehicleDto {
  @IsOptional()
  @IsString()
  @Length(1, 20)
  @ApiPropertyOptional({ example: 'REF-07' })
  code?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  @ApiPropertyOptional({ example: 'WP-REF-07' })
  registrationNo?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100_000)
  @ApiPropertyOptional({ example: 3000 })
  weightCapKg?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  @ApiPropertyOptional({ example: 20 })
  volumeCapM3?: number;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  @ApiPropertyOptional({ example: 'diesel' })
  fuelType?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @ApiPropertyOptional({ example: 6 })
  kmPerL?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100_000)
  @ApiPropertyOptional({ example: 400 })
  weeklyFuelQuotaL?: number;
}
