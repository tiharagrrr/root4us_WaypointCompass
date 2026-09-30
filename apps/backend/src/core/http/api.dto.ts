import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** The shapes every response shares, for OpenAPI and the generated client. */

export class LinkDto {
  @ApiProperty({
    example: '/api/v1/orders/0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e',
  })
  href!: string;

  @ApiPropertyOptional({ enum: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] })
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

  @ApiPropertyOptional({ example: 'Cancel order' })
  title?: string;

  @ApiPropertyOptional()
  templated?: boolean;

  @ApiPropertyOptional({ example: ['If-Match', 'reasonNote'], type: [String] })
  requires?: string[];
}

export class NoticeDto {
  @ApiProperty({ example: 'ORDER_ROLLED_TO_NEXT_RUN' })
  code!: string;

  @ApiProperty({ example: 'Sent after the 4 PM cutoff: delivers Saturday.' })
  message!: string;
}

export class MetaDto {
  @ApiProperty({ example: '0192a3f5-1b2c-7d3e-8f4a-5b6c7d8e9f0a' })
  requestId!: string;

  @ApiProperty({ example: '2026-10-01T15:40:03+05:30' })
  serverTime!: string;

  @ApiProperty({ example: '1.0.0' })
  apiVersion!: string;

  @ApiPropertyOptional({ type: [NoticeDto] })
  notices?: NoticeDto[];
}

export class OffsetPageDto {
  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 0 })
  offset!: number;

  @ApiProperty({ example: 57 })
  total!: number;
}

export class CursorPageDto {
  @ApiProperty({ example: 50 })
  limit!: number;

  @ApiProperty({ type: String, nullable: true, example: null })
  nextCursor!: string | null;

  @ApiProperty({ example: false })
  hasMore!: boolean;
}

export class OffsetPageMetaDto extends MetaDto {
  @ApiProperty({ type: OffsetPageDto })
  page!: OffsetPageDto;
}

export class CursorPageMetaDto extends MetaDto {
  @ApiProperty({ type: CursorPageDto })
  page!: CursorPageDto;
}

export class FieldErrorDto {
  @ApiProperty({ example: 'lines[2].qty' })
  field!: string;

  @ApiProperty({ example: 'min' })
  code!: string;

  @ApiProperty({ example: 'Enter at least 1' })
  message!: string;
}

/** RFC 9457 problem details, as ProblemDetailsFilter renders every error. */
export class ProblemDto {
  @ApiProperty({
    example: 'https://compass.waypoint.lk/problems/validation-failed',
  })
  type!: string;

  @ApiProperty({ example: 'Some fields need attention' })
  title!: string;

  @ApiProperty({ example: 400 })
  status!: number;

  @ApiProperty({ example: 'VALIDATION_FAILED' })
  code!: string;

  @ApiPropertyOptional()
  detail?: string;

  @ApiProperty({ example: '/api/v1/orders' })
  instance!: string;

  @ApiProperty({ example: '0192a3f5-1b2c-7d3e-8f4a-5b6c7d8e9f0a' })
  requestId!: string;

  @ApiPropertyOptional({ type: [FieldErrorDto] })
  errors?: FieldErrorDto[];

  @ApiPropertyOptional({
    description: 'PLAN_RULE_VIOLATION only: the broken rules',
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  violations?: Record<string, unknown>[];
}

/**
 * Query parameters of a list endpoint. Filters arrive as filter[field]=a,b or
 * filter[field][op]=value and are checked against the resource's
 * ResourceSpec; @ApiPaginated documents the ones each resource allows.
 */
export class ListQueryDto {
  @ApiPropertyOptional({ description: 'Page size', example: 10, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @ApiPropertyOptional({ description: 'Tables: rows to skip', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({
    description: 'Feeds: meta.page.nextCursor of the previous page',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Comma-separated fields, "-" for descending',
    example: '-submittedAt',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sort?: string;

  @ApiPropertyOptional({ description: 'Search text' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Comma-separated related resources' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  include?: string;

  @ApiHideProperty()
  @IsOptional()
  @IsObject()
  filter?: Record<string, unknown>;
}

export class IncludeQueryDto {
  @ApiPropertyOptional({ description: 'Comma-separated related resources' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  include?: string;
}
