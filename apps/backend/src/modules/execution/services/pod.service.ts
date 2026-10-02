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
import type { PresignAttachmentDto } from '../dto/attachment.dto';
import {
  ATTACHMENT_MAX_BYTES,
  DOWNLOAD_URL_MINUTES,
  EXECUTION_AUDIT,
  UPLOAD_URL_MINUTES,
} from '../execution.constants';
import { MyTripsQueries } from './my-trips.queries';
import { StopQueries } from './stop.queries';

/**
 * Proof of delivery: the signature or photo a driver captures at the dock,
 * and the link a store manager opens later (AC-EXE-16).
 *
 * The file never passes through the API. The phone asks for a presigned URL,
 * PUTs the file straight to the store and confirms; a reader is redirected to
 * a presigned URL of their own, good for five minutes. Core's
 * `AttachmentsService` owns the row and the storage key; what belongs here is
 * who may attach to what — the owner is read through the module's scope, so
 * another driver's stop and another outlet's delivery are both 404.
 */
@Injectable()
export class PodService {
  constructor(
    private readonly attachments: AttachmentsService,
    private readonly stops: StopQueries,
    private readonly trips: MyTripsQueries,
    private readonly audit: AuditService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(PodService.name);
  }

  /** Somewhere to put the file, for ten minutes. Idempotent on clientUuid. */
  @Transactional()
  async presign(
    dto: PresignAttachmentDto,
    actor: Actor,
  ): Promise<{ attachment: AttachmentRow; upload: PresignedUrl }> {
    await this.ownerInScope(dto.owner.type, dto.owner.id, actor);
    const { attachment, upload, created } = await this.attachments.presign({
      kind: dto.kind,
      contentType: dto.contentType,
      bytes: dto.bytes,
      sha256: dto.sha256 ?? null,
      clientUuid: dto.clientUuid,
      owner: dto.owner,
      capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : null,
      maxBytes: ATTACHMENT_MAX_BYTES,
      uploadMinutes: UPLOAD_URL_MINUTES,
      createdById: actor.id,
    });
    // A retried presign is the same request again: one row, one audit row.
    if (created)
      await this.audit.record({
        action: EXECUTION_AUDIT.attachmentPresigned,
        entity: ['attachment', attachment.id],
        after: {
          kind: attachment.kind,
          ownerType: attachment.ownerType,
          ownerId: attachment.ownerId,
          contentType: attachment.contentType,
          bytes: attachment.bytes,
        },
        clientUuid: dto.clientUuid,
        source: 'PWA',
      });
    return { attachment, upload };
  }

  /** The file is in the store, so it counts as proof from now on. */
  @Transactional()
  async complete(id: string, actor: Actor): Promise<AttachmentRow> {
    const row = await this.visible(id, actor);
    if (row.uploadedAt) return row;
    const saved = await this.attachments.complete(id);
    await this.audit.record({
      action: EXECUTION_AUDIT.attachmentUploaded,
      entity: ['attachment', id],
      after: { uploadedAt: saved.uploadedAt },
      clientUuid: saved.clientUuid ?? undefined,
      source: 'PWA',
    });
    this.log.info(
      {
        event: EXECUTION_AUDIT.attachmentUploaded,
        attachmentId: id,
        ownerType: saved.ownerType,
        ownerId: saved.ownerId,
      },
      'attachment uploaded',
    );
    return saved;
  }

  /** A link to read the file with, good for five minutes (AC-EXE-16). */
  async download(id: string, actor: Actor): Promise<PresignedUrl> {
    const row = await this.visible(id, actor);
    return this.attachments.download(row, DOWNLOAD_URL_MINUTES);
  }

  async get(id: string, actor: Actor): Promise<AttachmentRow> {
    return this.visible(id, actor);
  }

  /**
   * The attachment, if its owner is in the caller's scope. Anything else is
   * 404 about the attachment, not about the stop behind it: a store manager
   * of another outlet learns nothing from the answer.
   */
  private async visible(id: string, actor: Actor): Promise<AttachmentRow> {
    const row = await this.attachments.get(id);
    try {
      await this.ownerInScope(row.ownerType, row.ownerId, actor);
    } catch {
      throw new NotFoundError('attachment');
    }
    return row;
  }

  private async ownerInScope(
    type: string,
    id: string,
    actor: Actor,
  ): Promise<void> {
    if (type === 'stop') await this.stops.get(id, actor);
    else if (type === 'trip') await this.trips.get(id, actor);
    // Load flags and issues carry their own attachments through loading and
    // receipt; execution answers for its own owners only.
    else throw new NotFoundError('attachment');
  }
}
