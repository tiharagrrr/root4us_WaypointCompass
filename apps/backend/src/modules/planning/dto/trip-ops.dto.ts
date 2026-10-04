import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ViolationDto } from './plan-engine.dto';
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

/** 19a, 19b: take one stop still to come off the trip, with a reason (AC-PLN-25). */
export class DeferStopDto {
  @ApiProperty({ example: 'ACCESS_ISSUE', description: 'Required' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reasonCode?: string;

  @ApiPropertyOptional({
    example: 'Road closed at Ja-Ela',
    description: 'The store reads it',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** 19b's preview: the stops still to come in the order being tried (AC-PLN-38). */
export class ResequencePreviewRequestDto {
  @ApiProperty({
    type: [String],
    example: ['0192a3f4-0000-7000-8000-00000000d103'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  stopIds!: string[];
}

export class PreviewStopDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000d103' })
  stopId!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T07:46:00.000Z',
  })
  arrivalAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 14,
    description: 'Minutes before the window closes; negative is late',
  })
  spareMin!: number | null;
}

export class ResequencePreviewDto {
  @ApiProperty({ type: [PreviewStopDto] })
  @Type(() => PreviewStopDto)
  stops!: PreviewStopDto[];

  @ApiProperty({ type: [ViolationDto] })
  @Type(() => ViolationDto)
  violations!: ViolationDto[];
}

/** 20's repair (AC-PLN-06): one other vehicle, as the engine sees it for this trip. */
export class RepairOptionDto {
  @ApiProperty({ example: 'VEH018' })
  vehicleId!: string;

  @ApiProperty({ example: 'DRY-18' })
  code!: string;

  @ApiProperty({ example: 1, description: 'The trip number it would run as' })
  tripNo!: number;

  @ApiProperty({ example: true, description: 'No hard rule broken' })
  fits!: boolean;

  @ApiProperty({
    type: [String],
    example: [],
    description: 'Hard rules it breaks',
  })
  rules!: string[];

  @ApiProperty({ type: [String], example: [] })
  messages!: string[];
}

/** 20's driver picker (AC-PLN-37). */
export class DriverOptionDto {
  @ApiProperty({ example: 'drv-nuwan' })
  driverId!: string;

  @ApiProperty({ example: 'Nuwan Gunasekara' })
  name!: string;

  @ApiProperty({ example: 0, description: 'Trips the driver has on this plan' })
  tripsOnPlan!: number;
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
