import { ApiProperty } from '@nestjs/swagger';
import type { Link } from '@waypoint/shared';
import { Matches } from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';
import { ViolationDto } from './plan-engine.dto';

export class PlanDayParamsDto {
  @ApiProperty({ example: 'PLG' })
  @Matches(/^[A-Za-z0-9_-]{1,40}$/)
  depotId!: string;

  @ApiProperty({
    example: '2026-10-02',
    description: 'Business date, Asia/Colombo',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;
}

export class PlanSummaryDto {
  @ApiProperty({ example: 14 })
  trips!: number;

  @ApiProperty({ example: 71, description: 'Orders on a trip' })
  plannedOrders!: number;

  @ApiProperty({ example: 12, description: 'Orders on no trip' })
  unplanned!: number;

  @ApiProperty({
    example: 3,
    description: 'Unplanned orders with no confirmed deferral yet',
  })
  undecided!: number;
}

/** One depot's plan for one date (05, 09, 17). */
export class PlanDto {
  @ApiProperty({ example: '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e' })
  id!: string;

  @ApiProperty({ example: 'PLG' })
  depotId!: string;

  @ApiProperty({ example: '2026-10-02' })
  date!: string;

  @ApiProperty({ enum: ['DRAFT', 'PUBLISHED', 'CLOSED'], example: 'DRAFT' })
  status!: 'DRAFT' | 'PUBLISHED' | 'CLOSED';

  @ApiProperty({
    example: 0,
    description: '0 until published, 1 at publish, +1 per change after',
  })
  revision!: number;

  @ApiProperty({
    example: 7,
    description: 'Echoed as the ETag; send it back as If-Match',
  })
  version!: number;

  @ApiProperty({
    example: '2026-10-01T16:00:00+05:30',
    description: "When publishing opens: the previous operating day's cutoff",
  })
  publishOpensAt!: string;

  @ApiProperty({ nullable: true, type: String, example: null })
  publishedAt!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  publishedById!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  closedAt!: string | null;

  @ApiProperty({ type: PlanSummaryDto })
  summary!: PlanSummaryDto;

  /**
   * self, trips, context, unplanned, revisions, engineRuns (POST), vehicleOptions, orderOptions,
   * validate (POST), edits (POST), suggestFixes (POST), decisions (POST), publishPreview, and
   * publish (POST), the last only when publishing would be accepted now.
   */
  @ApiLinks()
  _links!: Record<string, Link>;
}

/** One stop on a trip, in stop order. */
export class PlanStopDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000c001' })
  id!: string;

  @ApiProperty({ nullable: true, type: Number, example: 1 })
  seq!: number | null;

  @ApiProperty({
    enum: ['PENDING', 'ARRIVED', 'DELIVERED', 'PARTIAL', 'FAILED', 'CANCELLED'],
    example: 'PENDING',
  })
  status!: string;

  @ApiProperty({ example: '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e' })
  orderId!: string;

  @ApiProperty({ example: 'WF-0171' })
  orderNo!: string;

  @ApiProperty({ example: 'OUT014' })
  outletId!: string;

  @ApiProperty({ example: 'Fresh Kadawatha' })
  outletName!: string;

  @ApiProperty({ example: 24 })
  units!: number;

  @ApiProperty({ example: 312.5 })
  weightKg!: number;

  @ApiProperty({ example: 1.84 })
  volumeM3!: number;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T04:07:00+05:30',
  })
  plannedArrivalAt!: string | null;

  @ApiProperty({ example: 16 })
  plannedServiceMin!: number;

  @ApiProperty({
    example: 210,
    description: 'Effective window, minutes after midnight',
  })
  windowOpenMin!: number;

  @ApiProperty({ example: 480 })
  windowCloseMin!: number;
}

/** One trip on the plan (09), with its stops and what it uses of its vehicle. */
export class TripDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000d001' })
  id!: string;

  @ApiProperty({ example: 'REF-07#1' })
  key!: string;

  @ApiProperty({ example: '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e' })
  planId!: string;

  @ApiProperty({ example: 'VEH014' })
  vehicleId!: string;

  @ApiProperty({ example: 'REF-07' })
  vehicleCode!: string;

  @ApiProperty({ nullable: true, type: String, example: null })
  driverId!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Aniqa Razick' })
  driverName!: string | null;

  @ApiProperty({ nullable: true, type: Number, example: 1 })
  tripNo!: number | null;

  @ApiProperty({ enum: ['FRESH', 'STYLE', 'TECH'], example: 'FRESH' })
  brand!: string;

  @ApiProperty({ example: 'gampaha' })
  districtId!: string;

  @ApiProperty({ example: 'Gampaha' })
  districtName!: string;

  @ApiProperty({ enum: ['CHILLED', 'AMBIENT'], example: 'CHILLED' })
  tempClass!: string;

  @ApiProperty({
    enum: [
      'RESERVED',
      'PLANNED',
      'LOADING',
      'RELEASED',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
    ],
    example: 'PLANNED',
  })
  status!: string;

  @ApiProperty({
    example: false,
    description: 'Built or edited by hand; Auto-suggest keeps it',
  })
  locked!: boolean;

  @ApiProperty({ example: false })
  isReserved!: boolean;

  @ApiProperty({ nullable: true, type: String, example: null })
  waveId!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T03:30:00+05:30',
  })
  plannedDepartAt!: string | null;

  @ApiProperty({
    example: 213,
    description: 'Trip minutes, return leg excluded',
  })
  minutes!: number;

  @ApiProperty({
    example: 270,
    description: "The vehicle's daily budget for this brand",
  })
  budgetMinutes!: number;

  @ApiProperty({ example: 64 })
  plannedKm!: number;

  @ApiProperty({ example: 12.8 })
  plannedFuelL!: number;

  @ApiProperty({ example: 2840 })
  loadWeightKg!: number;

  @ApiProperty({ example: 11.6 })
  loadVolumeM3!: number;

  @ApiProperty({ example: 3000 })
  weightCapKg!: number;

  @ApiProperty({ example: 12 })
  volumeCapM3!: number;

  @ApiProperty({ example: 3 })
  version!: number;

  @ApiProperty({ type: [PlanStopDto] })
  stops!: PlanStopDto[];

  @ApiProperty({
    type: [ViolationDto],
    description: "This trip's violations, hard and soft",
  })
  violations!: ViolationDto[];

  @ApiLinks()
  _links!: Record<string, Link>;
}
