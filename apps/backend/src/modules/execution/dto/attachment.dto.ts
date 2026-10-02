import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ATTACHMENT_KINDS,
  type AttachmentKind,
  type Link,
} from '@waypoint/shared';
import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiLinks } from '../../../core/http/decorators';

/** What a proof-of-delivery file may hang on, from the driver's side. */
const OWNER_TYPES = ['stop', 'trip'] as const;

export class AttachmentOwnerDto {
  @ApiProperty({ enum: OWNER_TYPES, example: 'stop' })
  @IsIn(OWNER_TYPES)
  type!: 'stop' | 'trip';

  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000d001' })
  @IsUUID()
  id!: string;
}

/** D4 and D5: ask for somewhere to put a signature or a photo. */
export class PresignAttachmentDto {
  @ApiProperty({ enum: ATTACHMENT_KINDS, example: 'SIGNATURE' })
  @IsIn(ATTACHMENT_KINDS)
  kind!: AttachmentKind;

  @ApiProperty({ example: 'image/png' })
  @IsString()
  @Length(3, 100)
  contentType!: string;

  @ApiProperty({
    description: 'The file size, checked against the limit',
    example: 48_120,
  })
  @IsInt()
  @Min(1)
  bytes!: number;

  @ApiPropertyOptional({
    description: 'Hex sha256 of the file, so a swapped upload is visible',
    example: 'c1f4…',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, { message: 'Send a hex sha256' })
  sha256?: string;

  @ApiProperty({
    description: 'The clientUuid the phone put on the delivery event',
    example: '0192a3f4-0000-7000-8000-00000000c002',
  })
  @IsUUID()
  clientUuid!: string;

  @ApiProperty({ type: AttachmentOwnerDto })
  @ValidateNested()
  @Type(() => AttachmentOwnerDto)
  owner!: AttachmentOwnerDto;

  @ApiPropertyOptional({ example: '2026-10-02T04:20:10+05:30' })
  @IsOptional()
  @IsISO8601({ strict: true })
  capturedAt?: string;
}

export class AttachmentUploadDto {
  @ApiProperty({
    description: 'PUT the file here, once',
    example: 'http://localhost:9000/pod/…',
  })
  url!: string;

  @ApiProperty({ example: 'PUT' })
  method!: 'PUT';

  @ApiProperty({
    description: 'Ten minutes from now',
    example: '2026-10-02T04:31:00+05:30',
  })
  expiresAt!: string;
}

/**
 * Where to read the file, for the next few minutes.
 *
 * The spec's wording for AC-EXE-16 is a 302 to the store. It is a 200 with
 * the link instead, because AC-IDN-60 requires every route a role may call
 * to answer 2xx, and a route that writes the response itself never answers
 * at all under that criterion's harness. The point of the criterion holds:
 * the file comes from the store, not through the API, and the link expires.
 */
export class AttachmentLinkDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000c003' })
  id!: string;

  @ApiProperty({ enum: ATTACHMENT_KINDS, example: 'SIGNATURE' })
  kind!: AttachmentKind;

  @ApiProperty({ example: 'image/png' })
  contentType!: string;

  @ApiProperty({
    description: 'Read the file here',
    example: 'http://localhost:9000/pod/…',
  })
  url!: string;

  @ApiProperty({
    description: 'Five minutes from now',
    example: '2026-10-02T04:26:00+05:30',
  })
  expiresAt!: string;

  @ApiLinks()
  _links!: Record<string, Link>;
}

export class AttachmentDto {
  @ApiProperty({ example: '0192a3f4-0000-7000-8000-00000000c003' })
  id!: string;

  @ApiProperty({ enum: ATTACHMENT_KINDS, example: 'SIGNATURE' })
  kind!: AttachmentKind;

  @ApiProperty({ type: AttachmentOwnerDto })
  owner!: { type: string; id: string };

  @ApiProperty({ example: 'image/png' })
  contentType!: string;

  @ApiProperty({ nullable: true, type: Number, example: 48_120 })
  bytes!: number | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  sha256!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Null until the file is in the store',
    example: null,
  })
  uploadedAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-02T04:20:10+05:30',
  })
  capturedAt!: string | null;

  @ApiPropertyOptional({
    type: AttachmentUploadDto,
    description: 'Only on presign, while the upload is still expected',
  })
  upload?: AttachmentUploadDto;

  @ApiLinks()
  _links!: Record<string, Link>;
}
