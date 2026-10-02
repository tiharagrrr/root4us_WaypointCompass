import { ApiProperty } from '@nestjs/swagger';
import {
  BRANDS,
  type Brand,
  DOCK_TYPES,
  type DockType,
  PARKING_CONSTRAINTS,
  type ParkingConstraint,
  STOP_STATUSES,
  type StopStatus,
  TEMP_CLASSES,
  type TempClass,
  TRIP_STATUSES,
  type TripStatus,
} from '@waypoint/shared';
import { StopWindowDto } from './stop.dto';
import { TripVehicleDto } from './trip.dto';

/**
 * The offline bundle, typed, because every driver screen after D1 reads its
 * data from this one document through the generated hooks (architecture rule
 * 9) and the phone keeps it in Dexie. Anything a driver may need with no
 * signal belongs here; anything else does not, because the budget is about
 * 50 KB for a whole run (AC-EXE-04).
 */
export class BundleTripDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000b001' })
  id!: string;

  @ApiProperty({ nullable: true, type: Number, example: 1 })
  tripNo!: number | null;

  @ApiProperty({
    description: 'Business date, Asia/Colombo',
    example: '2026-10-02',
  })
  date!: string;

  @ApiProperty({ enum: TRIP_STATUSES, example: 'RELEASED' })
  status!: TripStatus;

  @ApiProperty({ enum: BRANDS, example: 'FRESH' })
  brand!: Brand;

  @ApiProperty({ enum: TEMP_CLASSES, example: 'CHILLED' })
  tempClass!: TempClass;

  @ApiProperty({ example: 'PLG' })
  depotId!: string;

  @ApiProperty({ example: 'gampaha' })
  districtId!: string;

  @ApiProperty({ type: TripVehicleDto })
  vehicle!: TripVehicleDto;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T03:30:00+05:30',
  })
  plannedDepartAt!: string | null;
}

/** What D9 Dock and access shows with the network off. */
export class BundleOutletDto {
  @ApiProperty({ example: 'OUT014' })
  id!: string;

  @ApiProperty({ example: 'Fresh Kadawatha' })
  name!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Kandy Road, Kadawatha',
  })
  address!: string | null;

  @ApiProperty({ nullable: true, type: Number, example: 7.0014 })
  lat!: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 79.9507 })
  lng!: number | null;

  @ApiProperty({ enum: DOCK_TYPES, example: 'REAR_DOCK' })
  dockType!: DockType;

  @ApiProperty({ enum: PARKING_CONSTRAINTS, example: 'NORMAL' })
  parkingConstraint!: ParkingConstraint;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Gate 2 after 06:00; reverse in from the lane',
  })
  accessNotes!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'K. Fernando' })
  contactName!: string | null;

  @ApiProperty({ nullable: true, type: String, example: '+94 71 234 5678' })
  contactPhone!: string | null;
}

export class BundleLineDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000f001' })
  id!: string;

  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000a001' })
  itemId!: string;

  @ApiProperty({ example: 'FR-A001' })
  sku!: string;

  @ApiProperty({ example: 'Rice 5 kg' })
  name!: string;

  @ApiProperty({ example: 'Case of 6' })
  packLabel!: string;

  @ApiProperty({ description: 'Packs to hand over', example: 10 })
  qty!: number;
}

export class BundleOrderDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000e001' })
  id!: string;

  @ApiProperty({ example: 'WF-0171' })
  orderNo!: string;

  @ApiProperty({ enum: TEMP_CLASSES, example: 'CHILLED' })
  tempClass!: TempClass;

  @ApiProperty({ example: 10 })
  units!: number;

  @ApiProperty({ type: [BundleLineDto] })
  lines!: BundleLineDto[];
}

export class BundleStopDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000d001' })
  id!: string;

  @ApiProperty({ nullable: true, type: Number, example: 1 })
  seq!: number | null;

  @ApiProperty({ enum: STOP_STATUSES, example: 'PENDING' })
  status!: StopStatus;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T04:00:00+05:30',
  })
  plannedArrivalAt!: string | null;

  @ApiProperty({ description: 'Minutes allowed at the dock', example: 12 })
  plannedServiceMin!: number;

  @ApiProperty({ type: StopWindowDto })
  window!: StopWindowDto;

  @ApiProperty({ type: BundleOutletDto })
  outlet!: BundleOutletDto;

  @ApiProperty({ type: BundleOrderDto })
  order!: BundleOrderDto;
}

export class OfflineBundleDto {
  @ApiProperty({ type: BundleTripDto })
  trip!: BundleTripDto;

  @ApiProperty({ type: [BundleStopDto], description: 'In planned order' })
  stops!: BundleStopDto[];

  @ApiProperty({
    description: 'The trip version, which is what POST /downloaded records',
    example: 3,
  })
  version!: number;

  @ApiProperty({
    description:
      'sha256 of the bundle; it changes whenever anything in it does',
    example: '9f2b1c4e…',
  })
  hash!: string;

  @ApiProperty({ example: '2026-10-02T03:05:00+05:30' })
  generatedAt!: string;
}
