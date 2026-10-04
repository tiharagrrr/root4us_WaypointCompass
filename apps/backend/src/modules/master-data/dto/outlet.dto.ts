import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BRANDS,
  type Brand,
  DOCK_TYPES,
  type DockType,
  type Link,
  PARKING_CONSTRAINTS,
  type ParkingConstraint,
} from '@waypoint/shared';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';

const MINUTE_OF_DAY = { min: 0, max: 1439 } as const;

/** The store manager linked to the outlet (A3). */
export class OutletManagerDto {
  @ApiProperty({ example: 'user_01J9' })
  id!: string;

  @ApiProperty({ example: 'Nimesha Periyapperuma' })
  name!: string;
}

/**
 * One outlet as A3 lists it and D9 reads it. Clock times carry both the
 * integer minutes the engine uses and the label a screen shows
 * (`windowOpenMin: 360, windowOpen: "06:00"`, AC-MD-03).
 */
export class OutletDto {
  @ApiProperty({ example: 'OUT014' })
  id!: string;

  @ApiProperty({ example: 'Fresh Kadawatha' })
  name!: string;

  @ApiProperty({ enum: BRANDS, enumName: 'Brand', example: 'FRESH' })
  brand!: Brand;

  @ApiProperty({ example: 'gampaha' })
  districtId!: string;

  @ApiProperty({ example: 'PLG' })
  depotId!: string;

  @ApiProperty({ enum: DOCK_TYPES, enumName: 'DockType', example: 'REAR_DOCK' })
  dockType!: DockType;

  @ApiProperty({
    enum: PARKING_CONSTRAINTS,
    enumName: 'ParkingConstraint',
    example: 'NORMAL',
  })
  parkingConstraint!: ParkingConstraint;

  @ApiProperty({ description: 'Minutes after midnight', example: 360 })
  windowOpenMin!: number;

  @ApiProperty({ example: '06:00' })
  windowOpen!: string;

  @ApiProperty({ example: 600 })
  windowCloseMin!: number;

  @ApiProperty({ example: '10:00' })
  windowClose!: string;

  @ApiProperty({ nullable: true, type: Number, example: null })
  mallWindowOpenMin!: number | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  mallWindowOpen!: string | null;

  @ApiProperty({ nullable: true, type: Number, example: null })
  mallWindowCloseMin!: number | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  mallWindowClose!: string | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: "Style's weekly delivery day, 0 = Monday",
    example: null,
  })
  styleDeliveryDow!: number | null;

  @ApiProperty({ nullable: true, type: String, example: 'Kadawatha, Gampaha' })
  address!: string | null;

  @ApiProperty({ nullable: true, type: Number, example: 7.0012 })
  lat!: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 79.9521 })
  lng!: number | null;

  @ApiProperty({ nullable: true, type: String, example: 'Mr Perera' })
  receivingContactName!: string | null;

  @ApiProperty({ nullable: true, type: String, example: '+94711234567' })
  receivingContactPhone!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'D9: how to reach the dock',
    example: 'Use the lane behind the bakery.',
  })
  accessNotes!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  accessNotesUpdatedAt!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  accessNotesUpdatedById!: string | null;

  @ApiProperty({
    nullable: true,
    type: OutletManagerDto,
    description: 'The store manager linked here; null means nobody is (A3)',
  })
  manager!: OutletManagerDto | null;

  @ApiLinks()
  _links!: Record<string, Link>;
}

/**
 * PATCH /outlets/{id} (A3): the fields an admin may change. Half a mall
 * window and a close before the open are refused (AC-MD-01).
 */
export class UpdateOutletDto {
  @IsOptional()
  @IsIn(DOCK_TYPES)
  @ApiPropertyOptional({ enum: DOCK_TYPES, enumName: 'DockType' })
  dockType?: DockType;

  @IsOptional()
  @IsIn(PARKING_CONSTRAINTS)
  @ApiPropertyOptional({
    enum: PARKING_CONSTRAINTS,
    enumName: 'ParkingConstraint',
  })
  parkingConstraint?: ParkingConstraint;

  @IsOptional()
  @IsInt()
  @Min(MINUTE_OF_DAY.min)
  @Max(MINUTE_OF_DAY.max)
  @ApiPropertyOptional({ example: 360, minimum: 0, maximum: 1439 })
  windowOpenMin?: number;

  @IsOptional()
  @IsInt()
  @Min(MINUTE_OF_DAY.min)
  @Max(MINUTE_OF_DAY.max)
  @ApiPropertyOptional({ example: 600, minimum: 0, maximum: 1439 })
  windowCloseMin?: number;

  @IsOptional()
  @ValidateIf((o: UpdateOutletDto) => o.mallWindowOpenMin !== null)
  @IsInt()
  @Min(MINUTE_OF_DAY.min)
  @Max(MINUTE_OF_DAY.max)
  @ApiPropertyOptional({ nullable: true, type: Number, example: 420 })
  mallWindowOpenMin?: number | null;

  @IsOptional()
  @ValidateIf((o: UpdateOutletDto) => o.mallWindowCloseMin !== null)
  @IsInt()
  @Min(MINUTE_OF_DAY.min)
  @Max(MINUTE_OF_DAY.max)
  @ApiPropertyOptional({ nullable: true, type: Number, example: 540 })
  mallWindowCloseMin?: number | null;

  @IsOptional()
  @ValidateIf((o: UpdateOutletDto) => o.receivingContactName !== null)
  @IsString()
  @Length(1, 120)
  @ApiPropertyOptional({ nullable: true, type: String })
  receivingContactName?: string | null;

  @IsOptional()
  @ValidateIf((o: UpdateOutletDto) => o.receivingContactPhone !== null)
  @IsString()
  @Length(1, 40)
  @ApiPropertyOptional({ nullable: true, type: String })
  receivingContactPhone?: string | null;

  @IsOptional()
  @ValidateIf((o: UpdateOutletDto) => o.accessNotes !== null)
  @IsString()
  @Length(1, 1000)
  @ApiPropertyOptional({ nullable: true, type: String })
  accessNotes?: string | null;
}
