import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ISSUE_RESOLUTIONS,
  ISSUE_STATUSES,
  ISSUE_TYPES,
  type IssueResolution,
  type IssueStatus,
  type IssueType,
  type Link,
} from '@waypoint/shared';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';
import { COMMENT_MAX_LENGTH } from '../receipt.constants';

export class IssuePhotoDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000f001' })
  id!: string;

  @ApiProperty({
    example:
      '/api/v1/issues/0192a3f4-0000-7000-8000-00000000d001/attachments/0192a3f4-0000-7000-8000-00000000f001',
  })
  href!: string;
}

/** A problem a store or driver reported with a delivery (M6 and the issue thread). */
export class IssueDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000d001' })
  id!: string;

  @ApiProperty({ example: 'OUT014' })
  outletId!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '0192a3f4-0000-7000-8000-00000000a001',
  })
  orderId!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'WF-0171' })
  orderNo!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  stopId!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  receiptId!: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  orderLineId!: string | null;

  @ApiProperty({ enum: ISSUE_TYPES, enumName: 'IssueType', example: 'DAMAGED' })
  type!: IssueType;

  @ApiProperty({ nullable: true, type: Number, example: 3 })
  qtyAffected!: number | null;

  @ApiProperty({ example: '3 trays damaged' })
  description!: string;

  @ApiProperty({
    enum: ISSUE_STATUSES,
    enumName: 'IssueStatus',
    example: 'OPEN',
  })
  status!: IssueStatus;

  @ApiProperty({
    nullable: true,
    enum: ISSUE_RESOLUTIONS,
    enumName: 'IssueResolution',
    type: String,
    example: null,
  })
  resolution!: IssueResolution | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  resolutionNote!: string | null;

  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000u001' })
  raisedById!: string;

  @ApiProperty({ example: 'store_manager' })
  raisedByRole!: string;

  @ApiProperty({ nullable: true, type: String, example: null })
  resolvedById!: string | null;

  @ApiProperty({ example: '2026-10-02T10:30:00+05:30' })
  createdAt!: string;

  @ApiProperty({ nullable: true, type: String, example: null })
  resolvedAt!: string | null;

  @ApiProperty({ type: () => [IssuePhotoDto] })
  photos!: IssuePhotoDto[];

  @ApiLinks()
  _links!: Record<string, Link>;
}

/** M6 and D5: report a problem. Either the order or the stop says what it is about. */
export class CreateIssueDto {
  @ApiPropertyOptional({ example: '0192a3f4-0000-7000-8000-00000000a001' })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({
    description: 'A driver can name the stop instead',
    example: '0192a3f4-0000-7000-8000-00000000s001',
  })
  @IsOptional()
  @IsUUID()
  stopId?: string;

  @ApiPropertyOptional({
    description: 'The line the problem is about',
    example: '0192a3f4-0000-7000-8000-00000000c001',
  })
  @IsOptional()
  @IsUUID()
  orderLineId?: string;

  @ApiProperty({ enum: ISSUE_TYPES, example: 'DAMAGED' })
  @IsIn(ISSUE_TYPES)
  type!: IssueType;

  @ApiPropertyOptional({ description: 'Packs the problem touches', example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  qtyAffected?: number;

  @ApiProperty({ example: '3 trays damaged' })
  @IsString()
  @Length(1, 1000)
  description!: string;
}

/** The dispatcher closes an issue with what is being done about it. */
export class ResolveIssueDto {
  @ApiProperty({ enum: ISSUE_RESOLUTIONS, example: 'CREDIT_ISSUED' })
  @IsIn(ISSUE_RESOLUTIONS)
  resolution!: IssueResolution;

  @ApiPropertyOptional({ example: 'Credit note sent' })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  note?: string;
}

export class CommentDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000g001' })
  id!: string;

  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000d001' })
  issueId!: string;

  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000u001' })
  authorId!: string;

  @ApiProperty({ example: 'dispatcher' })
  authorRole!: string;

  @ApiProperty({ nullable: true, type: String, example: 'Tihara Egodage' })
  authorName!: string | null;

  @ApiProperty({ example: 'Credit on the way' })
  body!: string;

  @ApiProperty({ example: '2026-10-02T10:45:00+05:30' })
  createdAt!: string;

  @ApiLinks()
  _links!: Record<string, Link>;
}

export class CreateCommentDto {
  @ApiProperty({
    description: `Plain text, up to ${COMMENT_MAX_LENGTH} characters`,
    example: 'Credit on the way',
  })
  @IsString()
  @Length(1, COMMENT_MAX_LENGTH)
  body!: string;
}

/** A photo for an issue: the file goes straight to the store with the URL that comes back. */
export class PresignIssuePhotoDto {
  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @Length(3, 100)
  contentType!: string;

  @ApiProperty({ example: 48_120 })
  @IsInt()
  @Min(1)
  bytes!: number;

  @ApiPropertyOptional({ example: 'c1f4…' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, { message: 'Send a hex sha256' })
  sha256?: string;

  @ApiProperty({
    description: 'Made on the device, so a retry returns the same photo',
    example: '0192a3f4-0000-7000-8000-00000000h001',
  })
  @IsUUID()
  clientUuid!: string;
}

export class IssuePhotoUploadDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000f001' })
  id!: string;

  @ApiProperty({ example: false })
  uploaded!: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'https://s3.local/waypoint/issue/…',
  })
  uploadUrl!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T10:40:00+05:30',
  })
  uploadExpiresAt!: string | null;

  @ApiLinks()
  _links!: Record<string, Link>;
}

export class IssuePhotoLinkDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000f001' })
  id!: string;

  @ApiProperty({ example: 'https://s3.local/waypoint/issue/…' })
  url!: string;

  @ApiProperty({ example: '2026-10-02T10:50:00+05:30' })
  expiresAt!: string;

  @ApiLinks()
  _links!: Record<string, Link>;
}
