import { ApiProperty } from '@nestjs/swagger';
import type { Link } from '@waypoint/shared';
import { Type } from 'class-transformer';
import { IsOptional, Matches } from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';

const STOP_STANDINGS = [
  'DELIVERED',
  'PARTIAL',
  'FAILED',
  'NEXT',
  'AT_RISK',
  'LATE',
  'PLANNED',
] as const;
const TRIP_STANDINGS = [
  'ON_TIME',
  'LATE_RISK',
  'LOADING',
  'PLANNED',
  'COMPLETE',
] as const;

export class TrackingQueryDto {
  @ApiProperty({
    required: false,
    example: '2026-10-02',
    description: 'Business date; today by default',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}

/** One stop on 19a's timeline: planned, projected and actual. */
export class TrackingStopDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000d101' })
  stopId!: string;

  @ApiProperty({ nullable: true, type: Number, example: 4 })
  seq!: number | null;

  @ApiProperty({ example: 'WF-0171' })
  orderNo!: string;

  @ApiProperty({ example: 'OUT014' })
  outletId!: string;

  @ApiProperty({ example: 'Fresh Ja-Ela' })
  outletName!: string;

  @ApiProperty({ example: 'PENDING' })
  status!: string;

  @ApiProperty({
    example: 330,
    description: 'Window opens, minutes after midnight',
  })
  windowOpenMin!: number;

  @ApiProperty({
    example: 480,
    description: 'Window closes, minutes after midnight',
  })
  windowCloseMin!: number;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T07:40:00+05:30',
  })
  plannedArrivalAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T07:42:00+05:30',
    description:
      'Projected arrival for a stop still to come; from the engine, from now when the trip is on the road',
  })
  etaAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 18,
    description:
      'Minutes between the projected (or planned) arrival and the window closing; negative is late',
  })
  spareMin!: number | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  arrivedAt!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  completedAt!: string | null;

  @ApiProperty({ enum: STOP_STANDINGS, example: 'NEXT' })
  standing!: (typeof STOP_STANDINGS)[number];
}

/** One trip on 19's list and 01's Today's runs. */
export class TrackingTripDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000c101' })
  tripId!: string;

  @ApiProperty({ example: 'REF-07' })
  vehicleCode!: string;

  @ApiProperty({ example: 'TRUCK' })
  vehicleType!: string;

  @ApiProperty({ example: 'REEFER' })
  vehicleTemp!: string;

  @ApiProperty({ nullable: true, type: Number, example: 1 })
  tripNo!: number | null;

  @ApiProperty({ nullable: true, type: String, example: 'Aniqa Razick' })
  driverName!: string | null;

  @ApiProperty({ example: 'FRESH' })
  brand!: string;

  @ApiProperty({ example: 'CHILLED' })
  tempClass!: string;

  @ApiProperty({ example: 'IN_PROGRESS' })
  status!: string;

  @ApiProperty({ enum: TRIP_STANDINGS, example: 'ON_TIME' })
  standing!: (typeof TRIP_STANDINGS)[number];

  @ApiProperty({
    nullable: true,
    type: String,
    example: null,
    description: 'Why the trip cannot run, when the driver or a breakdown said',
  })
  cantRunReason!: string | null;

  @ApiProperty({ example: 3 })
  delivered!: number;

  @ApiProperty({ example: 10 })
  stopsTotal!: number;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T07:42:00+05:30',
  })
  nextEtaAt!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Fresh Ja-Ela' })
  nextOutletName!: string | null;

  @ApiProperty({ nullable: true, type: Number, example: 420 })
  nextWindowOpenMin!: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 480 })
  nextWindowCloseMin!: number | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T04:40:00+05:30',
  })
  plannedDepartAt!: string | null;

  @ApiProperty({ example: 3420 })
  loadWeightKg!: number;

  @ApiProperty({ example: 15.8 })
  loadVolumeM3!: number;

  @ApiProperty({ type: [TrackingStopDto] })
  @Type(() => TrackingStopDto)
  stops!: TrackingStopDto[];
}

export class TrackingTotalsDto {
  @ApiProperty({ example: 14 })
  trips!: number;

  @ApiProperty({ example: 11, description: 'Trips in progress' })
  onRoad!: number;

  @ApiProperty({
    example: 14,
    description: 'Trips released, on the road or done',
  })
  released!: number;

  @ApiProperty({ example: 148 })
  stopsPlanned!: number;

  @ApiProperty({ example: 64 })
  stopsDelivered!: number;

  @ApiProperty({
    example: 2,
    description: 'Stops still to come projected past their window',
  })
  lateRisk!: number;

  @ApiProperty({ example: 7, description: 'Confirmed deferrals on the plan' })
  deferred!: number;

  @ApiProperty({ example: 2 })
  repeatSkips!: number;
}

/** 01, 19 and 19a: one depot's day on the road. */
export class TrackingDayDto {
  @ApiProperty({ example: 'PLG' })
  depotId!: string;

  @ApiProperty({ example: '2026-10-02' })
  date!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e',
  })
  planId!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'PUBLISHED' })
  planStatus!: string | null;

  @ApiProperty({ type: TrackingTotalsDto })
  @Type(() => TrackingTotalsDto)
  totals!: TrackingTotalsDto;

  @ApiProperty({ type: [TrackingTripDto] })
  @Type(() => TrackingTripDto)
  trips!: TrackingTripDto[];

  /** self, plan, endOfDay. */
  @ApiLinks()
  _links!: Record<string, Link>;
}

/** M3: when a store's order is due, with no vehicle position (AC-EXE-22). */
export class OrderEtaDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000o001' })
  orderId!: string;

  @ApiProperty({ example: 'WF-0171' })
  orderNo!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'The stop the order is on; null until it is planned',
    example: '0192a3f4-0000-7000-8000-00000000s001',
  })
  stopId!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'IN_PROGRESS' })
  tripStatus!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'PENDING' })
  stopStatus!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T05:40:00+05:30',
  })
  plannedArrivalAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T05:54:00+05:30',
    description:
      'When the delivery is expected: projected from now while the trip is on the road, the planned arrival before that, null once the stop is done or when the order is on no trip',
  })
  etaAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 6,
    description:
      'Minutes between the ETA and the window closing; negative is late',
  })
  spareMin!: number | null;

  @ApiProperty({ nullable: true, enum: STOP_STANDINGS, example: 'NEXT' })
  standing!: (typeof STOP_STANDINGS)[number] | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T05:52:00+05:30',
  })
  completedAt!: string | null;

  @ApiLinks()
  _links!: Record<string, Link>;
}
