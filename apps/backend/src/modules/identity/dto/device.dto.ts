import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiLinks } from '../../../core/http/decorators';
import type { Link } from '@waypoint/shared';
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { devicePlatformEnum } from '../../../db/schema';

type DevicePlatform = (typeof devicePlatformEnum.enumValues)[number];

/** POST /me/devices: the app registers the device it runs on. */
export class RegisterDeviceDto {
  @IsString()
  @Length(1, 100)
  @Matches(/^[\w-]+$/, { message: 'Letters, digits, - and _ only' })
  @ApiProperty({
    description: 'Generated on the device and kept in IndexedDB',
    example: 'P2',
  })
  id!: string;

  @IsIn(devicePlatformEnum.enumValues)
  @ApiProperty({
    enum: devicePlatformEnum.enumValues,
    enumName: 'DevicePlatform',
  })
  platform!: DevicePlatform;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @ApiPropertyOptional({ example: "Aniqa's phone" })
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @ApiPropertyOptional({ example: '0.1.0' })
  appVersion?: string;
}

export class DeviceDto {
  @ApiProperty({ example: 'P2' })
  id!: string;

  @ApiProperty({
    enum: devicePlatformEnum.enumValues,
    enumName: 'DevicePlatform',
  })
  platform!: DevicePlatform;

  @ApiProperty({ nullable: true, type: String })
  label!: string | null;

  @ApiProperty({ description: 'Only dock devices may use PIN sign-in' })
  isDockDevice!: boolean;

  @ApiProperty({ nullable: true, type: String, example: null })
  depotId!: string | null;

  @ApiProperty({ nullable: true, type: String, example: '0.1.0' })
  appVersion!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  lastSeenAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** PUT /devices/{id}/dock: the depot this tablet serves as a dock device. */
export class DockDeviceDto {
  @IsString()
  @Length(1, 40)
  @ApiProperty({ example: 'PLG' })
  depotId!: string;
}

/** A device on A6's dock tablets card, with what the admin may do to it. */
export class AdminDeviceDto extends DeviceDto {
  @ApiLinks()
  _links!: Record<string, Link>;
}
