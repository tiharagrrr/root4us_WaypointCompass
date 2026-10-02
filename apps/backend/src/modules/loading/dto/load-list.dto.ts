import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  LOAD_FLAG_DECISIONS,
  LOAD_FLAG_REASONS,
  LOAD_FLAG_STATUSES,
  LOAD_LINE_STATUSES,
  RELEASE_CHECKS,
  type LoadFlagDecision,
  type LoadFlagReason,
  type LoadFlagStatus,
  type LoadLineStatus,
  type Links,
  type ReleaseCheckId,
  TEMP_CLASSES,
  type TempClass,
  TRIP_STATUSES,
  type TripStatus,
} from '@waypoint/shared';
import { ApiLinks } from '../../../core/http/decorators';

/** The counts L2's header and L2m-a's cards show. */
export class LoadProgressDto {
  @ApiProperty() lines!: number;
  @ApiProperty({ description: 'OK, replaced or removed' }) checked!: number;
  @ApiProperty({ description: 'Still PENDING or FLAGGED' })
  outstanding!: number;
  @ApiProperty({ description: 'OPEN or AWAITING_RECHECK' }) openFlags!: number;
}

/** One flag on a line, as L3a to L3c and the dispatcher's queue show it. */
export class LoadFlagDto {
  @ApiProperty() id!: string;
  @ApiProperty() tripId!: string;
  @ApiProperty() loadLineId!: string;
  @ApiProperty({ enum: LOAD_FLAG_REASONS }) reason!: LoadFlagReason;
  @ApiProperty() qtyAffected!: number;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiProperty({ enum: LOAD_FLAG_STATUSES }) status!: LoadFlagStatus;

  @ApiPropertyOptional({ enum: LOAD_FLAG_DECISIONS, nullable: true })
  decision!: LoadFlagDecision | null;
  @ApiPropertyOptional({ nullable: true }) decisionNote!: string | null;
  @ApiPropertyOptional({ nullable: true }) decidedById!: string | null;
  @ApiPropertyOptional({ nullable: true }) decidedAt!: string | null;

  /** The name typed on the dock tablet, which is who actually saw it. */
  @ApiProperty() raisedByName!: string;
  @ApiPropertyOptional({ nullable: true }) raisedByUserId!: string | null;
  @ApiProperty() raisedAt!: string;
  @ApiPropertyOptional({ nullable: true }) resolvedAt!: string | null;

  @ApiLinks() _links!: Links;
}

/** One line of the checklist: one item of one order on one stop. */
export class LoadLineDto {
  @ApiProperty() id!: string;
  @ApiProperty() tripId!: string;
  @ApiProperty() orderId!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Null for an order with no lines, whose units are the line',
  })
  orderLineId!: string | null;

  @ApiProperty({ description: "The stop's seq; the list reads highest first" })
  stopSeq!: number;

  @ApiProperty({ enum: LOAD_LINE_STATUSES }) status!: LoadLineStatus;
  @ApiProperty() qtyExpected!: number;
  @ApiPropertyOptional({ nullable: true }) qtyLoaded!: number | null;

  @ApiProperty({ description: 'The plan revision this line belongs to' })
  planRevision!: number;

  @ApiProperty() orderNo!: string;
  @ApiProperty() outletId!: string;
  @ApiProperty() outletName!: string;
  @ApiPropertyOptional({ nullable: true }) sku!: string | null;
  @ApiPropertyOptional({ nullable: true }) itemName!: string | null;
  @ApiPropertyOptional({ nullable: true }) packLabel!: string | null;

  /** Who checked it, as typed on the shared tablet (AC-LOD-04). */
  @ApiPropertyOptional({ nullable: true }) checkedByName!: string | null;
  @ApiPropertyOptional({ nullable: true }) checkedByUserId!: string | null;
  @ApiPropertyOptional({ nullable: true }) checkedAt!: string | null;

  @ApiProperty({ type: [LoadFlagDto] }) flags!: LoadFlagDto[];
  @ApiLinks() _links!: Links;
}

/** One stop's card on L2: where these goods are going. */
export class LoadStopDto {
  @ApiProperty() stopSeq!: number;
  @ApiProperty() orderId!: string;
  @ApiProperty() orderNo!: string;
  @ApiProperty() outletId!: string;
  @ApiProperty() outletName!: string;
  @ApiProperty({ description: 'Lines still PENDING or FLAGGED' })
  outstanding!: number;
  @ApiProperty({ type: [LoadLineDto] }) lines!: LoadLineDto[];
}

/** One release precondition, as L4 draws it and a 409 lists it. */
export class ReleaseCheckDto {
  @ApiProperty({ enum: RELEASE_CHECKS }) id!: ReleaseCheckId;
  @ApiProperty() label!: string;
  @ApiProperty() pass!: boolean;
  @ApiProperty() detail!: string;
}

/** The trip fields the dock needs beside its list. */
export class LoadTripDto {
  @ApiProperty() id!: string;
  @ApiProperty() planId!: string;
  @ApiProperty() depotId!: string;
  @ApiProperty({ description: 'The business date, Asia/Colombo' })
  date!: string;
  @ApiProperty() vehicleId!: string;
  @ApiPropertyOptional({ nullable: true }) driverId!: string | null;
  @ApiProperty({ enum: TRIP_STATUSES }) status!: TripStatus;
  @ApiProperty({ enum: TEMP_CLASSES }) tempClass!: TempClass;
  @ApiPropertyOptional({ nullable: true }) waveId!: string | null;
  @ApiPropertyOptional({ nullable: true }) plannedDepartAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) releasedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) releaseTempC!: number | null;
  @ApiProperty({ description: "The plan's current revision" })
  planRevision!: number;
}

/** GET /trips/{id}/load-list: L2, last stop first. */
export class LoadListDto {
  @ApiProperty({ type: LoadTripDto }) trip!: LoadTripDto;

  @ApiProperty({
    type: [LoadStopDto],
    description: 'Last stop first: the first stop’s goods go in last',
  })
  stops!: LoadStopDto[];

  @ApiProperty({ type: LoadProgressDto }) progress!: LoadProgressDto;

  @ApiProperty({
    description:
      'The revision the lines carry; behind the plan after a revision',
  })
  listRevision!: number;

  @ApiProperty({
    description: 'False after a revision, until the dock reloads the list',
  })
  upToDate!: boolean;

  /** Who released it and against which revision; null until it is released. */
  @ApiPropertyOptional({ nullable: true }) releasedByName!: string | null;

  @ApiProperty({ type: [ReleaseCheckDto] }) releaseChecks!: ReleaseCheckDto[];
  @ApiLinks() _links!: Links;
}

/** One trip on L2's trip list and L2m-a's run cards. */
export class LoadTripSummaryDto extends LoadTripDto {
  @ApiProperty() outletCount!: number;
  @ApiProperty({ type: LoadProgressDto }) progress!: LoadProgressDto;
  @ApiLinks() _links!: Links;
}

/** One wave on L2m-a, with the trips under it. */
export class LoadRunDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Null for the trips that belong to no wave',
  })
  waveId!: string | null;
  @ApiProperty() label!: string;
  @ApiPropertyOptional({ nullable: true }) departFromMin!: number | null;
  @ApiPropertyOptional({ nullable: true }) departToMin!: number | null;
  @ApiProperty({ type: LoadProgressDto }) progress!: LoadProgressDto;
  @ApiProperty({ type: [LoadTripSummaryDto] }) trips!: LoadTripSummaryDto[];
}

/** GET /trips/{id}/release-checks: L4's checklist. */
export class ReleaseChecksDto {
  @ApiProperty() tripId!: string;
  @ApiProperty({ description: 'True when every check passes' })
  canRelease!: boolean;
  @ApiProperty({ type: [ReleaseCheckDto] }) checks!: ReleaseCheckDto[];
  @ApiProperty({
    description: 'Warmest reefer temperature this trip may leave at, °C',
  })
  maxReleaseTempC!: number;
  @ApiProperty({ description: "The plan's revision the release must match" })
  planRevision!: number;
  @ApiLinks() _links!: Links;
}
