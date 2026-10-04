import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { PinoLogger } from 'nestjs-pino';
import {
  type AttachmentRow,
  AttachmentsService,
} from '../../../core/attachments/attachments.service';
import { NotFoundError } from '../../../core/errors/domain-errors';
import type { PresignedUrl } from '../../../core/storage/storage.port';
import { AuditService } from '../../audit';
import type { PresignIssuePhotoDto } from '../dto/issue.dto';
import {
  ISSUE_PHOTO_OWNER,
  PHOTO_DOWNLOAD_MINUTES,
  PHOTO_MAX_BYTES,
  PHOTO_UPLOAD_MINUTES,
  RECEIPT_AUDIT,
} from '../receipt.constants';
import { IssueQueries } from './issue.queries';

/**
 * Photos on an issue (M6). Execution's attachment endpoints answer for stops and trips
 * only, so an issue's photos have their own: the phone asks for a URL, PUTs the file
 * straight to the store and confirms; a reader is sent a URL good for five minutes. The
 * rows are `platform.attachments` rows of kind ISSUE_PHOTO owned by the issue; core's
 * AttachmentsService writes them, this decides who may.
 */
@Injectable()
export class IssuePhotosService {
  constructor(
    private readonly attachments: AttachmentsService,
    private readonly issues: IssueQueries,
    private readonly audit: AuditService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(IssuePhotosService.name);
  }

  @Transactional()
  async presign(
    issueId: string,
    dto: PresignIssuePhotoDto,
    actor: Actor,
  ): Promise<{ attachment: AttachmentRow; upload: PresignedUrl }> {
    await this.issues.getForPhoto(issueId, actor);
    const { attachment, upload } = await this.attachments.presign({
      kind: 'ISSUE_PHOTO',
      contentType: dto.contentType,
      bytes: dto.bytes,
      sha256: dto.sha256 ?? null,
      clientUuid: dto.clientUuid,
      owner: { type: ISSUE_PHOTO_OWNER, id: issueId },
      maxBytes: PHOTO_MAX_BYTES,
      uploadMinutes: PHOTO_UPLOAD_MINUTES,
      createdById: actor.id,
    });
    return { attachment, upload };
  }

  /** The file is in the store, so the photo counts from now on. */
  @Transactional()
  async complete(
    issueId: string,
    attachmentId: string,
    actor: Actor,
  ): Promise<AttachmentRow> {
    await this.issues.getForPhoto(issueId, actor);
    const row = await this.ownedBy(issueId, attachmentId);
    if (row.uploadedAt) return row;
    const saved = await this.attachments.complete(attachmentId);
    await this.audit.record({
      action: RECEIPT_AUDIT.issuePhotoAdded,
      entity: ['issue', issueId],
      after: { attachmentId, kind: saved.kind },
    });
    this.log.info(
      { event: RECEIPT_AUDIT.issuePhotoAdded, issueId, attachmentId },
      'issue photo added',
    );
    return saved;
  }

  /** A link to read the photo with, good for five minutes. */
  async download(
    issueId: string,
    attachmentId: string,
    actor: Actor,
  ): Promise<{ row: AttachmentRow; link: PresignedUrl }> {
    await this.issues.get(issueId, actor);
    const row = await this.ownedBy(issueId, attachmentId);
    return {
      row,
      link: await this.attachments.download(row, PHOTO_DOWNLOAD_MINUTES),
    };
  }

  private async ownedBy(
    issueId: string,
    attachmentId: string,
  ): Promise<AttachmentRow> {
    const row = await this.attachments.get(attachmentId);
    if (row.ownerType !== ISSUE_PHOTO_OWNER || row.ownerId !== issueId)
      throw new NotFoundError('attachment');
    return row;
  }
}
