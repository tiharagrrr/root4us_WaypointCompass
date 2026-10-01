import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PERMISSIONS,
  type Link,
  type Permission,
  USER_ROLES,
  type UserRole,
} from '@waypoint/shared';
import { IsIn, IsOptional } from 'class-validator';

/** English, Sinhala and Tamil (D12). */
export const LOCALES = ['en', 'si', 'ta'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * PATCH /me. Only the caller's own preferences: role, scope and PIN are set
 * by an admin, and any other field is refused with 400 naming it.
 */
export class UpdateMeDto {
  @IsOptional()
  @IsIn(LOCALES)
  @ApiPropertyOptional({ enum: LOCALES, example: 'si' })
  locale?: Locale;
}

export class MeDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-000000000001' })
  id!: string;

  @ApiProperty({ example: 'Nimesha Periyapperuma' })
  name!: string;

  @ApiProperty({ example: 'nimesha.p@waypoint.lk' })
  email!: string;

  @ApiProperty({ nullable: true, type: String, example: 'nimesha.p' })
  username!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  phoneNumber!: string | null;

  @ApiProperty({ enum: USER_ROLES, enumName: 'UserRole' })
  role!: UserRole;

  @ApiProperty({ nullable: true, type: String, example: null })
  depotId!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'OUT014' })
  outletId!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  vehicleId!: string | null;

  @ApiProperty({ enum: LOCALES, example: 'en' })
  locale!: string;

  @ApiProperty({
    enum: PERMISSIONS,
    isArray: true,
    example: ['order:read', 'order:submit'],
  })
  permissions!: Permission[];

  @ApiProperty({ type: Object })
  _links!: Record<string, Link>;
}
