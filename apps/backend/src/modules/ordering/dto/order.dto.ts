import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BRANDS,
  type Brand,
  type Link,
  ORDER_STATUSES,
  type OrderStatus,
  TEMP_CLASSES,
  type TempClass,
} from '@waypoint/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What the store manager asked for, added up from the lines (M1's summary card). */
export class OrderTotalsDto {
  @ApiProperty({ description: 'Distinct items on the order', example: 5 })
  lines!: number;

  @ApiProperty({ description: 'Packs across all lines', example: 40 })
  units!: number;

  @ApiProperty({ example: 544 })
  weightKg!: number;

  @ApiProperty({ example: 1.08 })
  volumeM3!: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Tech orders only; null for Fresh and Style',
    example: null,
  })
  valueLkr!: number | null;
}

export class OrderOutletDto {
  @ApiProperty({ example: 'OUT014' })
  id!: string;

  @ApiProperty({ example: 'Fresh Kadawatha' })
  name!: string;
}

/** The outlet's receiving window on the delivery day, as M1 shows it under Delivery. */
export class DeliveryWindowDto {
  @ApiProperty({ description: 'Minutes after midnight', example: 420 })
  openMin!: number;

  @ApiProperty({ example: '07:00' })
  open!: string;

  @ApiProperty({ example: 540 })
  closeMin!: number;

  @ApiProperty({ example: '09:00' })
  close!: string;
}

/** One line of an order (M1's table). Weights are the item's snapshot times the quantity. */
export class OrderLineDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000a001' })
  id!: string;

  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000b001' })
  itemId!: string;

  @ApiProperty({ example: 'FR-1102' })
  sku!: string;

  @ApiProperty({ example: 'Basmati rice 5 kg' })
  name!: string;

  @ApiProperty({ description: 'How the item is packed', example: 'Bag ×4' })
  packLabel!: string;

  @ApiProperty({ description: 'Packs', example: 12 })
  qty!: number;

  @ApiProperty({
    description: 'One pack, snapshot at the time of the line',
    example: 20,
  })
  unitWeightKg!: number;

  @ApiProperty({ example: 0.03 })
  unitVolumeM3!: number;

  @ApiProperty({ description: 'qty × unitWeightKg', example: 240 })
  weightKg!: number;

  @ApiProperty({ description: 'qty × unitVolumeM3', example: 0.36 })
  volumeM3!: number;

  @ApiProperty({
    description: 'False when the depot cannot supply the line',
    example: true,
  })
  available!: boolean;

  @ApiLinks()
  _links!: Record<string, Link>;
}

/**
 * An order as the store manager and the dispatcher see it (M1, M1b, M2, M3, M8, 03, 04).
 * `editableUntil` is the cutoff instant M1 counts down to; after it, `afterCutoff` is true and
 * `deliveryDate` has moved to the next run (M2).
 */
export class OrderDto {
  @ApiProperty({ example: '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e' })
  id!: string;

  @ApiProperty({ example: 'WF-0231' })
  orderNo!: string;

  @ApiProperty({
    enum: ORDER_STATUSES,
    enumName: 'OrderStatus',
    example: 'DRAFT',
  })
  status!: OrderStatus;

  @ApiProperty({
    enum: TEMP_CLASSES,
    enumName: 'TempClass',
    example: 'AMBIENT',
  })
  tempClass!: TempClass;

  @ApiProperty({ enum: BRANDS, enumName: 'Brand', example: 'FRESH' })
  brand!: Brand;

  @ApiProperty({
    description: "The outlet's district, which 03 groups the queue by",
    example: 'gampaha',
  })
  districtId!: string;

  @ApiProperty({
    description: 'The day the store asked for',
    example: '2026-10-02',
  })
  requestedDate!: string;

  @ApiProperty({ description: 'The run it is on now', example: '2026-10-02' })
  deliveryDate!: string;

  @ApiProperty({
    description: 'Sent after the cutoff, so it moved to the next run (M2)',
    example: false,
  })
  afterCutoff!: boolean;

  @ApiProperty({
    description: 'The dispatcher marked it urgent',
    example: false,
  })
  urgent!: boolean;

  @ApiProperty({ type: OrderTotalsDto })
  totals!: OrderTotalsDto;

  @ApiProperty({ type: OrderOutletDto })
  outlet!: OrderOutletDto;

  @ApiProperty({ type: DeliveryWindowDto })
  deliveryWindow!: DeliveryWindowDto;

  @ApiProperty({ nullable: true, type: String, example: null })
  note!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'The preset this order was started from',
    example: null,
  })
  templateId!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  submittedAt!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  cancelledAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: "A store's note or a dispatcher's reason code",
    example: null,
  })
  cancelReason!: string | null;

  @ApiProperty({
    description: 'The cutoff instant: edits and cancels close here',
    example: '2026-10-01T16:00:00+05:30',
  })
  editableUntil!: string;

  @ApiProperty({ example: 1 })
  version!: number;

  @ApiLinks()
  _links!: Record<string, Link>;
}

/** One line in a create or replace request: an item and how many packs of it. */
export class OrderLineInputDto {
  @IsUUID()
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000b001' })
  itemId!: string;

  @IsInt()
  @Min(1, { message: 'Enter at least 1' })
  @ApiProperty({ description: 'Whole packs', minimum: 1, example: 12 })
  qty!: number;
}

/**
 * POST /orders (M1). The outlet, depot, brand and district come from the actor's scope: sending
 * an outletId answers 400 (AC-ORD-10).
 */
export class CreateOrderDto {
  @IsIn(TEMP_CLASSES)
  @ApiProperty({
    enum: TEMP_CLASSES,
    enumName: 'TempClass',
    example: 'AMBIENT',
  })
  tempClass!: TempClass;

  @Matches(BUSINESS_DATE, { message: 'Use a date as YYYY-MM-DD' })
  @ApiProperty({ example: '2026-10-02' })
  requestedDate!: string;

  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({
    description: 'Start from this preset',
    example: '0192a3f4-0000-7000-8000-00000000c001',
  })
  templateId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  @ApiPropertyOptional({ example: 'Extra rice for the long weekend' })
  note?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  @ApiPropertyOptional({ type: [OrderLineInputDto] })
  lines?: OrderLineInputDto[];
}

/** PUT /orders/{id}/lines: the whole line set, as applying a preset does (M1). */
export class SetOrderLinesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one item' })
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  @ApiProperty({ type: [OrderLineInputDto] })
  lines!: OrderLineInputDto[];
}

/** PATCH /orders/{id}/lines/{lineId}: the quantity stepper on M1 and M1a. */
export class UpdateOrderLineDto {
  @IsInt()
  @Min(1, { message: 'Enter at least 1' })
  @ApiProperty({ minimum: 1, example: 14 })
  qty!: number;
}

/**
 * GET /orders/{id}/lines: the order's lines with the version to send back as If-Match, so M1 can
 * load the table and edit it without re-reading the order.
 */
export class OrderLinesDto {
  @ApiProperty({ example: '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e' })
  orderId!: string;

  @ApiProperty({ example: 1 })
  version!: number;

  @ApiProperty({ type: [OrderLineDto] })
  lines!: OrderLineDto[];

  @ApiLinks()
  _links!: Record<string, Link>;
}

/**
 * PATCH /orders/{id}: the note, and the day the store is asking for, while
 * the order is still editable. The outlet, class and brand never change:
 * a different class is a different order.
 */
export class UpdateOrderDto {
  @IsOptional()
  @Matches(BUSINESS_DATE, { message: 'Use a date as YYYY-MM-DD' })
  @ApiPropertyOptional({ example: '2026-10-03' })
  requestedDate?: string;

  @IsOptional()
  @ValidateIf((d: UpdateOrderDto) => d.note !== null)
  @IsString()
  @Length(1, 500)
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Extra rice' })
  note?: string | null;
}

/**
 * POST /orders/{id}/cancel. A store manager gives a note in their own words;
 * a dispatcher gives a code from the reason list (AC-ORD-20, AC-ORD-21).
 */
export class CancelOrderDto {
  @IsOptional()
  @IsString()
  @Length(1, 500)
  @ApiPropertyOptional({
    description: 'Required when a store manager cancels',
    example: 'Ordered twice',
  })
  reasonNote?: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message: 'Use a reason code such as STORE_CLOSED',
  })
  @ApiPropertyOptional({
    description: 'Required when a dispatcher cancels',
    example: 'STORE_CLOSED',
  })
  reasonCode?: string;
}

/** PATCH /orders/{id}/priority: the dispatcher's urgent flag on 03. */
export class SetOrderPriorityDto {
  @IsBoolean()
  @ApiProperty({ example: true })
  urgent!: boolean;
}
