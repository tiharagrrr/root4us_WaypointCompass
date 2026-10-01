import { ApiProperty } from '@nestjs/swagger';
import {
  BRANDS,
  type Brand,
  type Link,
  TEMP_CLASSES,
  type TempClass,
} from '@waypoint/shared';
import { ApiLinks } from '../../../core/http/decorators';

/**
 * One catalog item as M1a's picker and M9's catalog show it: the SKU, how it is packed, and what
 * one pack weighs and takes up. Quantities on an order are whole packs of this item.
 */
export class ItemDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000b001' })
  id!: string;

  @ApiProperty({ example: 'FR-1102' })
  sku!: string;

  @ApiProperty({ example: 'Basmati rice 5 kg' })
  name!: string;

  @ApiProperty({ enum: BRANDS, enumName: 'Brand', example: 'FRESH' })
  brand!: Brand;

  @ApiProperty({ description: 'Groups the picker on M1a', example: 'Grains' })
  category!: string;

  @ApiProperty({
    enum: TEMP_CLASSES,
    enumName: 'TempClass',
    example: 'AMBIENT',
  })
  tempClass!: TempClass;

  @ApiProperty({ description: 'How the item is packed', example: 'Bag ×4' })
  packLabel!: string;

  @ApiProperty({ description: 'One pack', example: 20 })
  unitWeightKg!: number;

  @ApiProperty({ example: 0.03 })
  unitVolumeM3!: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Tech items carry a value; Fresh and Style do not',
    example: null,
  })
  unitValueLkr!: number | null;

  @ApiProperty({ example: false })
  fragile!: boolean;

  @ApiProperty({
    description: 'Inactive items cannot be ordered',
    example: true,
  })
  active!: boolean;

  @ApiLinks()
  _links!: Record<string, Link>;
}
