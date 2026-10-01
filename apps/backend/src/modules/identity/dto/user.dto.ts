import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiLinks } from '../../../core/http/decorators';
import {
  type Link,
  USER_CHANGE_REASONS,
  USER_ROLES,
  type UserChangeReason,
  type UserRole,
} from '@waypoint/shared';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * PATCH /users/{id} (A1): a new role, scope or both. Leave a field out to keep
 * it; send null to clear a depot, outlet or vehicle. A change needs a
 * reasonCode and signs the user out everywhere.
 */
export class UpdateUserDto {
  @IsOptional()
  @IsIn(USER_ROLES)
  @ApiPropertyOptional({ enum: USER_ROLES, enumName: 'UserRole' })
  role?: UserRole;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  @ApiPropertyOptional({ nullable: true, type: String, example: 'PLG' })
  depotId?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  @ApiPropertyOptional({ nullable: true, type: String, example: 'OUT014' })
  outletId?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  @ApiPropertyOptional({ nullable: true, type: String, example: 'REF-07' })
  vehicleId?: string | null;

  @IsOptional()
  @IsIn(USER_CHANGE_REASONS)
  @ApiPropertyOptional({
    enum: USER_CHANGE_REASONS,
    enumName: 'UserChangeReason',
    description: 'Required when the role or scope changes',
  })
  reasonCode?: UserChangeReason;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  @ApiPropertyOptional({ example: 'Moved to the Kandy depot' })
  reasonNote?: string;
}

/** PUT /users/{id}/pin: a loader's dock PIN, unique among their depot's loaders. */
export class SetPinDto {
  @Matches(/^\d{4}$/, { message: 'The PIN is 4 digits' })
  @ApiProperty({ example: '2468', pattern: '^\\d{4}$' })
  pin!: string;
}

/** The names behind scope ids, for A1's "Linked to" column. */
export class ScopeNamesDto {
  @ApiProperty({ nullable: true, type: String, example: 'Peliyagoda' })
  depot!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Fresh Kadawatha' })
  outlet!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'REF-07 · WP CBA-1234',
  })
  vehicle!: string | null;
}

class NamedOptionDto {
  @ApiProperty({ example: 'PLG' })
  id!: string;

  @ApiProperty({ example: 'Peliyagoda' })
  name!: string;
}

class OutletOptionDto extends NamedOptionDto {
  @ApiProperty({ example: 'PLG' })
  depotId!: string;
}

class VehicleOptionDto {
  @ApiProperty({ example: 'VEH007' })
  id!: string;

  @ApiProperty({ example: 'REF-07' })
  code!: string;

  @ApiProperty({ example: 'WP CBA-1234' })
  registrationNo!: string;

  @ApiProperty({ example: 'PLG' })
  depotId!: string;
}

/** What a user's or an invitation's scope can point at (A2 "Link to"). */
export class ScopeOptionsDto {
  @ApiProperty({ type: [NamedOptionDto] })
  depots!: NamedOptionDto[];

  @ApiProperty({ type: [OutletOptionDto] })
  outlets!: OutletOptionDto[];

  @ApiProperty({ type: [VehicleOptionDto] })
  vehicles!: VehicleOptionDto[];
}

/** A user as an admin sees them on A1: never pinHash or the password account. */
export class UserDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-000000000001' })
  id!: string;

  @ApiProperty({ example: 'Harini De Mel' })
  name!: string;

  @ApiProperty({ example: 'harini.d@waypoint.lk' })
  email!: string;

  @ApiProperty({ nullable: true, type: String, example: 'harini.d' })
  username!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  phoneNumber!: string | null;

  @ApiProperty({ enum: USER_ROLES, enumName: 'UserRole' })
  role!: UserRole;

  @ApiProperty({ nullable: true, type: String, example: 'PLG' })
  depotId!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  outletId!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  vehicleId!: string | null;

  @ApiProperty({ description: 'Deactivated: cannot sign in' })
  banned!: boolean;

  @ApiProperty({
    description: 'A loader has a dock PIN; the PIN itself is never returned',
  })
  hasPin!: boolean;

  @ApiProperty({ type: ScopeNamesDto })
  scopeNames!: ScopeNamesDto;

  @ApiProperty({ example: '2026-09-30T10:00:00+05:30' })
  createdAt!: string;

  @ApiLinks()
  _links!: Record<string, Link>;
}

/**
 * One of the users the demo can switch between, for the account menu (DEMO_MODE only). It carries
 * no contact details beyond the sign-in email the seed uses, and never a password or a PIN.
 */
export class DemoUserDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-000000000001' })
  id!: string;

  @ApiProperty({ example: 'Nimesha Periyapperuma' })
  name!: string;

  @ApiProperty({ example: 'nimesha.p@waypoint.lk' })
  email!: string;

  @ApiProperty({ enum: USER_ROLES, enumName: 'UserRole' })
  role!: UserRole;

  @ApiProperty({ nullable: true, type: String, example: null })
  depotId!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'OUT014' })
  outletId!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  vehicleId!: string | null;

  @ApiProperty({ type: ScopeNamesDto })
  scopeNames!: ScopeNamesDto;
}

/** GET /demo/users: the cast the account menu switches between, in demo order. */
export class DemoUsersDto {
  @ApiProperty({ type: [DemoUserDto] })
  users!: DemoUserDto[];
}
