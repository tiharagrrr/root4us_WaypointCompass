import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DELIVERY_OUTCOMES,
  type DeliveryOutcome,
  type Link,
  STOP_STATUSES,
  type StopStatus,
} from '@waypoint/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';
import { LINE_CONDITIONS, type LineCondition } from '../domain/field-event';
import { FieldEventDto } from './trip.dto';

/** The outcomes D4 may record; D5 records the rest. */
const COMPLETED_OUTCOMES = ['DELIVERED', 'PARTIAL'] as const;
const FAILED_OUTCOMES = ['REFUSED', 'DAMAGED', 'OUTLET_CLOSED'] as const;

export class StopWindowDto {
  @ApiProperty({ example: 420 })
  openMin!: number;

  @ApiProperty({ example: '07:00' })
  open!: string;

  @ApiProperty({ example: 540 })
  closeMin!: number;

  @ApiProperty({ example: '09:00' })
  close!: string;
}

/** One stop as D3, D4 and D5 read it after recording. */
export class StopDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000d001' })
  id!: string;

  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000b001' })
  tripId!: string;

  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000e001' })
  orderId!: string;

  @ApiProperty({ example: 'OUT014' })
  outletId!: string;

  @ApiProperty({ example: 'Fresh Kadawatha' })
  outletName!: string;

  @ApiProperty({ nullable: true, type: Number, example: 1 })
  seq!: number | null;

  @ApiProperty({ enum: STOP_STATUSES, example: 'ARRIVED' })
  status!: StopStatus;

  @ApiProperty({ type: StopWindowDto })
  window!: StopWindowDto;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T04:00:00+05:30',
  })
  plannedArrivalAt!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  arrivedAt!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  completedAt!: string | null;

  @ApiProperty({ nullable: true, enum: DELIVERY_OUTCOMES, example: null })
  outcome!: DeliveryOutcome | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  receiverName!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  exceptionNote!: string | null;

  @ApiProperty({ nullable: true, type: Number, example: null })
  unitsDelivered!: number | null;

  @ApiProperty({ example: 1 })
  version!: number;

  @ApiLinks()
  _links!: Record<string, Link>;
}

/** One line as the driver counted it at the dock (D4). */
export class DeliveryLineDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000f001' })
  @IsUUID()
  orderLineId!: string;

  @ApiProperty({ description: 'Packs handed over', example: 8 })
  @IsInt()
  @Min(0)
  qtyDelivered!: number;

  @ApiProperty({ enum: LINE_CONDITIONS, example: 'damaged' })
  @IsIn(LINE_CONDITIONS)
  condition!: LineCondition;

  @ApiPropertyOptional({ example: '2 trays crushed' })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  note?: string;
}

/** D3 Arrive: the position is what 19a draws the actual arrival from. */
export class ArriveDto extends FieldEventDto {}

/**
 * D4 Deliver or part-deliver. Both need a receiver and a signature or photo,
 * and a part delivery also needs a note saying what was short (AC-EXE-10).
 */
export class CompleteStopDto extends FieldEventDto {
  @ApiProperty({ enum: COMPLETED_OUTCOMES, example: 'DELIVERED' })
  @IsIn(COMPLETED_OUTCOMES)
  outcome!: 'DELIVERED' | 'PARTIAL';

  @ApiProperty({ description: 'Who took the delivery', example: 'K. Fernando' })
  @IsString()
  @Length(1, 200)
  receiverName!: string;

  @ApiPropertyOptional({ example: '2 trays crushed' })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  note?: string;

  @ApiPropertyOptional({ type: [DeliveryLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DeliveryLineDto)
  lines?: DeliveryLineDto[];

  @ApiProperty({
    description: 'The signature or photo, by the clientUuid the phone made',
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  attachmentUuids!: string[];
}

/** D5 Could not deliver: an outcome and a note, and a photo if there is one. */
export class FailStopDto extends FieldEventDto {
  @ApiProperty({ enum: FAILED_OUTCOMES, example: 'OUTLET_CLOSED' })
  @IsIn(FAILED_OUTCOMES)
  outcome!: 'REFUSED' | 'DAMAGED' | 'OUTLET_CLOSED';

  @ApiProperty({ example: 'Shutter down' })
  @IsString()
  @Length(1, 2000)
  note!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  attachmentUuids?: string[];
}
