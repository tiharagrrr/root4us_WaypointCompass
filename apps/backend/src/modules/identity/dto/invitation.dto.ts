import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiLinks } from '../../../core/http/decorators';
import {
  INVITATION_STATUSES,
  type InvitationStatus,
  type Link,
  USER_ROLES,
  type UserRole,
} from '@waypoint/shared';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { ScopeNamesDto } from './user.dto';

/**
 * POST /invitations (A2). The fields follow the role: an outlet for a store
 * manager, a depot for a loader (optional for a dispatcher), a phone for a
 * driver, who may also get a depot and vehicle.
 */
export class CreateInvitationDto {
  @IsString()
  @Length(1, 120)
  @ApiProperty({ example: 'Kasun Perera' })
  name!: string;

  @IsIn(USER_ROLES)
  @ApiProperty({ enum: USER_ROLES, enumName: 'UserRole' })
  role!: UserRole;

  @IsOptional()
  @IsEmail()
  @ApiPropertyOptional({ example: 'kasun.p@waypoint.lk' })
  email?: string;

  @IsOptional()
  @Matches(/^\+94\d{9}$/, { message: 'Use +94 and nine digits' })
  @ApiPropertyOptional({ example: '+94771234567' })
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  @ApiPropertyOptional({ example: 'PLG' })
  depotId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  @ApiPropertyOptional({ example: 'OUT014' })
  outletId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  @ApiPropertyOptional({ example: 'REF-07' })
  vehicleId?: string;
}

/**
 * POST /invitations/{token}/accept. Email roles send the invited email and a
 * password; drivers the invited phone and the code from
 * /api/auth/phone-number/send-otp; loaders the invited email or phone and
 * their dock PIN.
 */
export class AcceptInvitationDto {
  @IsOptional()
  @IsEmail()
  @ApiPropertyOptional({ example: 'kamal.s@waypoint.lk' })
  email?: string;

  @IsOptional()
  @IsString()
  @Length(10, 128)
  @ApiPropertyOptional({ minLength: 10, maxLength: 128 })
  password?: string;

  @IsOptional()
  @Matches(/^\+94\d{9}$/, { message: 'Use +94 and nine digits' })
  @ApiPropertyOptional({ example: '+94776041932' })
  phoneNumber?: string;

  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'The code has six digits' })
  @ApiPropertyOptional({ example: '482913' })
  code?: string;

  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'The PIN is 4 digits' })
  @ApiPropertyOptional({ example: '2468' })
  pin?: string;
}

/** The invite landing (/invite/:token): enough to greet the invitee, nothing more. */
export class InvitationLandingDto {
  @ApiProperty({ example: 'Kasun Perera' })
  name!: string;

  @ApiProperty({ enum: USER_ROLES, enumName: 'UserRole' })
  role!: UserRole;

  @ApiProperty({ enum: INVITATION_STATUSES, enumName: 'InvitationStatus' })
  status!: InvitationStatus;

  @ApiProperty({ example: '2026-10-03T10:00:00+05:30' })
  expiresAt!: string;

  @ApiProperty({ nullable: true, type: String, example: null })
  email!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '+94 77 ••• 4567',
    description: 'Masked',
  })
  phoneNumber!: string | null;

  @ApiProperty({
    type: [String],
    example: ['phoneNumber', 'code'],
    description: 'The fields accept needs for this role',
  })
  accepts!: string[];

  @ApiLinks()
  _links!: Record<string, Link>;
}

/** The account an accepted invitation created; signedIn says whether a session cookie came with it. */
export class AcceptedInvitationDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-000000000003' })
  userId!: string;

  @ApiProperty({ example: 'Kasun Perera' })
  name!: string;

  @ApiProperty({ enum: USER_ROLES, enumName: 'UserRole' })
  role!: UserRole;

  @ApiProperty({
    description: 'False for loaders, who sign in at the dock with their PIN',
  })
  signedIn!: boolean;

  @ApiLinks()
  _links!: Record<string, Link>;
}

/** An invitation as A1 lists it: never the token or its hash. */
export class InvitationDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-000000000002' })
  id!: string;

  @ApiProperty({ example: 'Kasun Perera' })
  name!: string;

  @ApiProperty({ nullable: true, type: String, example: null })
  email!: string | null;

  @ApiProperty({ nullable: true, type: String, example: '+94771234567' })
  phoneNumber!: string | null;

  @ApiProperty({ enum: USER_ROLES, enumName: 'UserRole' })
  role!: UserRole;

  @ApiProperty({ nullable: true, type: String, example: 'PLG' })
  depotId!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  outletId!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'REF-07' })
  vehicleId!: string | null;

  @ApiProperty({ type: ScopeNamesDto })
  scopeNames!: ScopeNamesDto;

  @ApiProperty({
    enum: INVITATION_STATUSES,
    enumName: 'InvitationStatus',
    description: 'EXPIRED as soon as a PENDING invitation passes expiresAt',
  })
  status!: InvitationStatus;

  @ApiProperty({ example: '2026-10-03T09:00:00+05:30' })
  expiresAt!: string;

  @ApiProperty({ nullable: true, type: String })
  sentAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  acceptedAt!: string | null;

  @ApiProperty({ example: '2026-09-30T09:00:00+05:30' })
  createdAt!: string;

  @ApiLinks()
  _links!: Record<string, Link>;
}
