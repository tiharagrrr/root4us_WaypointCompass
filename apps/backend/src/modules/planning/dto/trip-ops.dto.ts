import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** 20: another vehicle, another driver or both, with a reason (AC-PLN-23). */
export class ReassignTripDto {
  @ApiPropertyOptional({ example: 'VEH018', description: 'The new vehicle' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  vehicleId?: string;

  @ApiPropertyOptional({ example: 'drv-nuwan', description: 'The new driver' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  driverId?: string;

  @ApiProperty({ example: 'VEHICLE_BREAKDOWN', description: 'Required' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reasonCode?: string;

  @ApiPropertyOptional({ example: 'REF-07 compressor fault' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** 19b: every stop still to come, in the new order, with a reason (AC-PLN-24). */
export class ResequenceTripDto {
  @ApiProperty({
    type: [String],
    example: ['0192a3f4-0000-7000-8000-00000000d103'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  stopIds!: string[];

  @ApiProperty({ example: 'OTHER', description: 'Required' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reasonCode?: string;

  @ApiPropertyOptional({ example: 'Seeduwa first, the Ja-Ela road is closed' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
