import { ApiProperty } from '@nestjs/swagger';
import { type Link, TEMP_CLASSES, type TempClass } from '@waypoint/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';
import { OrderLineInputDto } from './order.dto';

/** A preset line, with the item named so M1 can show the preset without another request. */
export class OrderTemplateLineDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000b001' })
  itemId!: string;

  @ApiProperty({ example: 'FR-1102' })
  sku!: string;

  @ApiProperty({ example: 'Basmati rice 5 kg' })
  name!: string;

  @ApiProperty({ example: 'Bag ×4' })
  packLabel!: string;

  @ApiProperty({ description: 'Packs', example: 12 })
  qty!: number;
}

/** A saved line set for one outlet and class: M1's "Preset for this order". */
export class OrderTemplateDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000c001' })
  id!: string;

  @ApiProperty({ example: 'Weekday top-up' })
  name!: string;

  @ApiProperty({
    enum: TEMP_CLASSES,
    enumName: 'TempClass',
    example: 'AMBIENT',
  })
  tempClass!: TempClass;

  @ApiProperty({ type: [OrderTemplateLineDto] })
  lines!: OrderTemplateLineDto[];

  @ApiProperty({ example: '2026-09-28T09:12:00+05:30' })
  createdAt!: string;

  @ApiLinks()
  _links!: Record<string, Link>;
}

/** POST /orders/{id}/save-as-template (M1 "Save as preset"). */
export class SaveAsTemplateDto {
  @IsString()
  @Length(1, 60)
  @ApiProperty({ example: 'Weekday top-up' })
  name!: string;
}

/** POST /order-templates: a preset built from scratch rather than from an order. */
export class CreateOrderTemplateDto {
  @IsString()
  @Length(1, 60)
  @ApiProperty({ example: 'Weekday top-up' })
  name!: string;

  @IsIn(TEMP_CLASSES)
  @ApiProperty({
    enum: TEMP_CLASSES,
    enumName: 'TempClass',
    example: 'AMBIENT',
  })
  tempClass!: TempClass;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one item' })
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  @ApiProperty({ type: [OrderLineInputDto] })
  lines!: OrderLineInputDto[];
}

/** PATCH /order-templates/{id}: renaming a preset is all M1 offers. */
export class UpdateOrderTemplateDto {
  @IsString()
  @Length(1, 60)
  @ApiProperty({ example: 'Weekday dry' })
  name!: string;
}
