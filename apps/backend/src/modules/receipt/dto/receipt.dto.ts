import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  type Link,
  ORDER_STATUSES,
  type OrderStatus,
  RECEIPT_STATUSES,
  type ReceiptStatus,
} from '@waypoint/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';
import { LINE_CONDITIONS, type LineCondition } from '../receipt.constants';

/** One line of M5: what was ordered, what the driver delivered and what the store says arrived. */
export class ReceiptLineDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000c001' })
  orderLineId!: string;

  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000b001' })
  itemId!: string;

  @ApiProperty({ example: 'FR-1102' })
  sku!: string;

  @ApiProperty({ example: 'Basmati rice 5 kg' })
  name!: string;

  @ApiProperty({ example: 'Bag ×4' })
  packLabel!: string;

  @ApiProperty({ description: 'Packs on the order', example: 12 })
  qtyExpected!: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      "Packs the driver recorded; null until the driver's record syncs",
    example: 12,
  })
  qtyDelivered!: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Packs the store says arrived; null until it confirms',
    example: null,
  })
  qtyReceived!: number | null;

  @ApiProperty({
    nullable: true,
    enum: LINE_CONDITIONS,
    type: String,
    example: null,
  })
  condition!: LineCondition | null;
}

/** A signature or photo the driver captured, opened through GET /attachments/{id}. */
export class ProofFileDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000e001' })
  id!: string;

  @ApiProperty({
    example: '/api/v1/attachments/0192a3f4-0000-7000-8000-00000000e001',
  })
  href!: string;
}

/** The driver's proof of delivery, as M5 shows it. */
export class ProofOfDeliveryDto {
  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Chathura (store staff)',
  })
  receiverName!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T04:22:00+05:30',
  })
  deliveredAt!: string | null;

  @ApiProperty({ nullable: true, type: () => ProofFileDto })
  signature!: ProofFileDto | null;

  @ApiProperty({ nullable: true, type: () => ProofFileDto })
  photo!: ProofFileDto | null;
}

/**
 * One order's receipt, whether or not the store has confirmed it yet. `status` is
 * PENDING until it does. `version` is the order's, and rides the ETag: the store
 * sends it back as If-Match when it confirms.
 */
export class ReceiptDto {
  @ApiProperty({
    description: 'The order id: an order has one receipt',
    example: '0192a3f4-0000-7000-8000-00000000a001',
  })
  id!: string;

  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000a001' })
  orderId!: string;

  @ApiProperty({ example: 'WF-0171' })
  orderNo!: string;

  @ApiProperty({ nullable: true, type: String, example: null })
  receiptId!: string | null;

  @ApiProperty({
    enum: ['PENDING', ...RECEIPT_STATUSES],
    example: 'PENDING',
  })
  status!: 'PENDING' | ReceiptStatus;

  @ApiProperty({
    enum: ORDER_STATUSES,
    enumName: 'OrderStatus',
    example: 'DELIVERED',
  })
  orderStatus!: OrderStatus;

  @ApiProperty({ nullable: true, type: String, example: 'DELIVERED' })
  stopStatus!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T04:10:00+05:30',
  })
  etaAt!: string | null;

  @ApiProperty({
    description:
      "True when the store confirmed before the driver's record arrived",
    example: false,
  })
  awaitingDriverSync!: boolean;

  @ApiProperty({ nullable: true, type: String, example: null })
  note!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  confirmedAt!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  confirmedById!: string | null;

  @ApiProperty({ description: "The order's version, for If-Match", example: 8 })
  version!: number;

  @ApiProperty({ type: () => [ReceiptLineDto] })
  lines!: ReceiptLineDto[];

  @ApiProperty({ type: () => ProofOfDeliveryDto })
  proof!: ProofOfDeliveryDto;

  @ApiProperty({
    type: [String],
    description: 'Issues raised with this receipt',
    example: [],
  })
  issueIds!: string[];

  @ApiLinks()
  _links!: Record<string, Link>;
}

/** M5: what the store says arrived on one line. */
export class ConfirmReceiptLineDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000c001' })
  @IsUUID()
  orderLineId!: string;

  @ApiProperty({ description: 'Packs that arrived', example: 12 })
  @IsInt()
  @Min(0)
  @Max(100_000)
  qtyReceived!: number;

  @ApiProperty({ enum: LINE_CONDITIONS, example: 'ok' })
  @IsIn(LINE_CONDITIONS)
  condition!: LineCondition;

  @ApiPropertyOptional({
    description: 'Packs the problem touches; the shortfall when left out',
    example: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  qtyAffected?: number;

  @ApiPropertyOptional({
    description: 'What went wrong on this line',
    example: 'Two cases missing',
  })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

export class ConfirmReceiptDto {
  @ApiProperty({ type: () => [ConfirmReceiptLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ConfirmReceiptLineDto)
  lines!: ConfirmReceiptLineDto[];

  @ApiPropertyOptional({ example: '2 trays short' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}
