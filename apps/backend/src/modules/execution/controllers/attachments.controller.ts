import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor as SignedIn } from '@waypoint/shared';
import {
  Actor,
  ApiProblems,
  ApiResource,
  RequirePermission,
} from '../../../core/http/decorators';
import type { AttachmentRow } from '../../../core/attachments/attachments.service';
import type { PresignedUrl } from '../../../core/storage/storage.port';
import {
  AttachmentDto,
  AttachmentLinkDto,
  PresignAttachmentDto,
} from '../dto/attachment.dto';
import { DOWNLOAD_URL_MINUTES } from '../execution.constants';
import { PodService } from '../services/pod.service';

/**
 * Proof of delivery (D4, D5, D8) and the store's copy of it (M5).
 *
 * Files never pass through the API: presign hands back a URL the phone PUTs
 * to for ten minutes, `/complete` confirms the object arrived, and a reader
 * is redirected to a URL of their own for five (AC-EXE-16).
 */
@ApiTags('execution')
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly pod: PodService) {}

  @Post('presign')
  @HttpCode(200)
  @RequirePermission('stop:record')
  @ApiResource(AttachmentDto)
  @ApiProblems(400, 404, 413)
  @ApiOperation({
    summary: 'Ask for somewhere to put a signature or photo',
    description:
      'The upload URL lasts 10 minutes. The same clientUuid returns the same attachment.',
  })
  async presign(@Body() dto: PresignAttachmentDto, @Actor() actor: SignedIn) {
    const { attachment, upload } = await this.pod.presign(dto, actor);
    return present(attachment, upload);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermission('stop:record')
  @ApiResource(AttachmentDto)
  @ApiProblems(404, 409)
  @ApiOperation({ summary: 'Confirm the file is in the store' })
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: SignedIn,
  ) {
    return present(await this.pod.complete(id, actor));
  }

  /**
   * M5 and 19a open the file itself: the answer is a link to the store, so
   * the browser fetches the bytes from there and the API never carries them.
   */
  @Get(':id')
  @RequirePermission('stop:read')
  @ApiResource(AttachmentLinkDto)
  @ApiProblems(404)
  @ApiOperation({
    summary: 'A link to an attachment',
    description: `The link lasts ${DOWNLOAD_URL_MINUTES} minutes.`,
  })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: SignedIn,
  ): Promise<
    Omit<AttachmentLinkDto, '_links'> & {
      _links: Record<string, { href: string }>;
    }
  > {
    const row = await this.pod.get(id, actor);
    const link = await this.pod.download(id, actor);
    return {
      id: row.id,
      kind: row.kind,
      contentType: row.contentType,
      url: link.url,
      expiresAt: link.expiresAt.toISOString(),
      _links: { self: { href: `/api/v1/attachments/${row.id}` } },
    };
  }
}

/** The attachment as a response, with the upload link while there is one. */
function present(
  row: AttachmentRow,
  upload?: PresignedUrl,
): Omit<AttachmentDto, '_links'> & {
  _links: Record<string, { href: string; method?: string }>;
} {
  return {
    id: row.id,
    kind: row.kind,
    owner: { type: row.ownerType, id: row.ownerId },
    contentType: row.contentType,
    bytes: row.bytes,
    sha256: row.sha256,
    uploadedAt: row.uploadedAt ? row.uploadedAt.toISOString() : null,
    capturedAt: row.capturedAt ? row.capturedAt.toISOString() : null,
    ...(upload && {
      upload: {
        url: upload.url,
        method: 'PUT' as const,
        expiresAt: upload.expiresAt.toISOString(),
      },
    }),
    _links: {
      self: { href: `/api/v1/attachments/${row.id}` },
      ...(row.uploadedAt
        ? {}
        : {
            complete: {
              href: `/api/v1/attachments/${row.id}/complete`,
              method: 'POST',
            },
          }),
    },
  };
}
