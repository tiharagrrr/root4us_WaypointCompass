import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import type { Request, Response } from 'express';
import { ListQueryDto } from '../../../core/http/api.dto';
import {
  Actor,
  ApiPaginated,
  ApiProblems,
  ApiResource,
  RequirePermission,
  UseIdempotency,
} from '../../../core/http/decorators';
import { compact, pageLinks } from '../../../core/http/links';
import {
  CommentDto,
  CreateCommentDto,
  CreateIssueDto,
  IssueDto,
  IssuePhotoLinkDto,
  IssuePhotoUploadDto,
  PresignIssuePhotoDto,
  ResolveIssueDto,
} from '../dto/issue.dto';
import { ISSUE_RESOURCE } from '../issue.resource';
import { CommentLinks } from '../policies/comment.links';
import { IssueLinks } from '../policies/issue.links';
import { parseOptionalIfMatch } from '../if-match';
import { IssuePhotosService } from '../services/issue-photos.service';
import { IssueQueries } from '../services/issue.queries';
import { IssueThreadService } from '../services/issue-thread.service';
import { IssuesService } from '../services/issues.service';

/**
 * Issues (M6, D5) and their thread. A store reports with the order's version in
 * `If-Match`; a driver, who does not hold the order, reports on a stop of their own trip
 * without one. A driver can raise issues but reads none (AC-RCP-11).
 */
@ApiTags('issues')
@Controller('issues')
export class IssuesController {
  constructor(
    private readonly queries: IssueQueries,
    private readonly issues: IssuesService,
    private readonly thread: IssueThreadService,
    private readonly photos: IssuePhotosService,
    private readonly links: IssueLinks,
    private readonly commentLinks: CommentLinks,
  ) {}

  @Get()
  @RequirePermission('issue:read')
  @ApiPaginated(IssueDto, { resource: ISSUE_RESOURCE })
  @ApiOperation({ summary: 'List issues' })
  async list(
    @Query() query: ListQueryDto,
    @Actor() actor: SignedIn,
    @Req() req: Request,
  ) {
    return this.links.page(await this.queries.list(query, actor), actor, req);
  }

  @Post()
  @RequirePermission('issue:create')
  @UseIdempotency()
  @ApiHeader({
    name: 'If-Match',
    required: false,
    description:
      'The order’s version, W/"<n>". Required for a store manager; a driver reports without it.',
  })
  @ApiResource(IssueDto, { status: 201 })
  @ApiProblems(400, 404, 409, 412, 428)
  @ApiOperation({ summary: 'Report an issue' })
  async create(
    @Body() dto: CreateIssueDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Actor() actor: SignedIn,
    @Res({ passthrough: true }) res: Response,
  ) {
    const version = parseOptionalIfMatch(
      ifMatch,
      actor.role === 'store_manager',
    );
    const issue = await this.issues.create(dto, actor, version);
    res.location(`/api/v1/issues/${issue.id}`);
    return this.links.one(issue, actor);
  }

  @Get(':id')
  @RequirePermission('issue:read')
  @ApiResource(IssueDto)
  @ApiOperation({ summary: 'One issue' })
  async get(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: SignedIn) {
    return this.links.one(await this.queries.get(id, actor), actor);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermission('issue:resolve')
  @ApiResource(IssueDto)
  @ApiProblems(400, 409)
  @ApiOperation({ summary: 'Resolve an issue' })
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveIssueDto,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(await this.issues.resolve(id, dto, actor), actor);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermission('issue:create')
  @ApiResource(IssueDto)
  @ApiProblems(409)
  @ApiOperation({ summary: 'Reopen a resolved issue (within 48 hours)' })
  async reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: SignedIn,
  ) {
    return this.links.one(await this.issues.reopen(id, actor), actor);
  }

  @Get(':id/comments')
  @RequirePermission('issue:read')
  @ApiPaginated(CommentDto)
  @ApiOperation({ summary: "An issue's thread, oldest first" })
  async comments(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: SignedIn,
    @Req() req: Request,
  ) {
    const rows = await this.thread.list(id, actor);
    const page = {
      limit: Math.max(rows.length, 1),
      offset: 0,
      total: rows.length,
    };
    return {
      items: rows.map((row) => this.commentLinks.one(row, actor)),
      page,
      links: { ...pageLinks(req, page), ...compact({}) },
    };
  }

  @Post(':id/comments')
  @RequirePermission('issue:read')
  @ApiResource(CommentDto, { status: 201 })
  @ApiProblems(400)
  @ApiOperation({
    summary: 'Comment on an issue',
    description:
      'Plain text up to 1,000 characters. The store and the dispatcher post.',
  })
  async comment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCommentDto,
    @Actor() actor: SignedIn,
  ) {
    return this.commentLinks.one(
      await this.thread.post(id, dto.body, actor),
      actor,
    );
  }

  @Post(':id/attachments/presign')
  @HttpCode(200)
  @RequirePermission('issue:create')
  @ApiResource(IssuePhotoUploadDto)
  @ApiProblems(400, 404, 413)
  @ApiOperation({
    summary: 'Somewhere to put an issue photo (valid 10 minutes)',
  })
  async presign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PresignIssuePhotoDto,
    @Actor() actor: SignedIn,
  ) {
    const { attachment, upload } = await this.photos.presign(id, dto, actor);
    return {
      id: attachment.id,
      uploaded: attachment.uploadedAt !== null,
      uploadUrl: upload.url,
      uploadExpiresAt: upload.expiresAt.toISOString(),
      _links: {
        self: { href: `/api/v1/issues/${id}/attachments/${attachment.id}` },
        complete: {
          href: `/api/v1/issues/${id}/attachments/${attachment.id}/complete`,
          method: 'POST',
        },
      },
    };
  }

  @Post(':id/attachments/:attachmentId/complete')
  @HttpCode(200)
  @RequirePermission('issue:create')
  @ApiResource(IssuePhotoUploadDto)
  @ApiProblems(404, 409)
  @ApiOperation({ summary: 'Confirm the photo is in the store' })
  async completePhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Actor() actor: SignedIn,
  ) {
    const row = await this.photos.complete(id, attachmentId, actor);
    return {
      id: row.id,
      uploaded: row.uploadedAt !== null,
      uploadUrl: null,
      uploadExpiresAt: null,
      _links: { self: { href: `/api/v1/issues/${id}/attachments/${row.id}` } },
    };
  }

  @Get(':id/attachments/:attachmentId')
  @RequirePermission('issue:read')
  @ApiResource(IssuePhotoLinkDto)
  @ApiProblems(404)
  @ApiOperation({ summary: 'A link to an issue photo (valid 5 minutes)' })
  async photo(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Actor() actor: SignedIn,
  ) {
    const { row, link } = await this.photos.download(id, attachmentId, actor);
    return {
      id: row.id,
      url: link.url,
      expiresAt: link.expiresAt.toISOString(),
      _links: { self: { href: `/api/v1/issues/${id}/attachments/${row.id}` } },
    };
  }
}
