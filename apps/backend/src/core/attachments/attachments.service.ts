import { Inject, Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { AttachmentKind } from '@waypoint/shared';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { ClockService } from '../clock/clock.service';
import {
  NotFoundError,
  PayloadTooLargeError,
  StateConflictError,
  ValidationError,
} from '../errors/domain-errors';
import type { StampedDrizzleAdapter } from '../persistence/transactions';
import { attachments } from '../../db/schema';
import {
  STORAGE,
  type PresignedUrl,
  type StoragePort,
} from '../storage/storage.port';

export type AttachmentRow = typeof attachments.$inferSelect;

/** What a photo or a signature may be. */
const CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export interface PresignInput {
  kind: AttachmentKind;
  contentType: string;
  bytes: number;
  sha256?: string | null;
  /** Made on the phone, so a retried presign returns the same attachment. */
  clientUuid: string;
  owner: { type: string; id: string };
  capturedAt?: Date | null;
  maxBytes: number;
  uploadMinutes: number;
  createdById: string;
}

/**
 * The files any entity may carry — proof of delivery, a load flag photo, an
 * issue photo — in `platform.attachments`, which core owns. The modules
 * decide who may attach what to which row (their scope policy) and write the
 * audit row; this service does the storage key, the presigned URLs and the
 * row itself, so execution, loading and receipt all keep files the same way.
 *
 * Nothing is uploaded through the API: the phone PUTs to the store with the
 * URL this hands back, then calls `complete`, which is the only thing that
 * sets `uploadedAt`. A row with `uploadedAt` null is an upload that was
 * offered and never arrived.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
    @Inject(STORAGE) private readonly storage: StoragePort,
  ) {}

  /**
   * A URL to upload to, and the row that will point at the object. The same
   * `clientUuid` twice returns the same attachment and writes no second row,
   * so a phone that retried on a bad line does not litter the store
   * (AC-EXE-16).
   */
  @Transactional()
  async presign(input: PresignInput): Promise<{
    attachment: AttachmentRow;
    upload: PresignedUrl;
    created: boolean;
  }> {
    if (!CONTENT_TYPES.has(input.contentType))
      throw new ValidationError([
        {
          field: 'contentType',
          code: 'unsupported',
          message: 'Send a JPEG, PNG, WebP or PDF',
        },
      ]);
    if (input.bytes > input.maxBytes)
      throw new PayloadTooLargeError(
        `That file is ${Math.round(input.bytes / 1024)} KB; the limit is ${Math.round(input.maxBytes / 1024)} KB.`,
      );

    const existing = await this.byClientUuid(input.clientUuid);
    const attachment = existing ?? (await this.insert(input));
    const upload = await this.storage.presignPut(attachment.storageKey, {
      contentType: attachment.contentType,
      bytes: attachment.bytes,
      sha256: attachment.sha256,
      expiresInSeconds: input.uploadMinutes * 60,
    });
    return { attachment, upload, created: !existing };
  }

  /**
   * The object is in the store, so the attachment counts as proof. Confirmed
   * twice, the second call changes nothing.
   */
  @Transactional()
  async complete(id: string): Promise<AttachmentRow> {
    const row = await this.get(id);
    if (row.uploadedAt) return row;
    if (!(await this.storage.exists(row.storageKey)))
      throw new StateConflictError(
        'That file is not in the store yet. Upload it with the link from presign, then confirm.',
      );
    const [saved] = await this.txHost.tx
      .update(attachments)
      .set({ uploadedAt: this.clock.now() })
      .where(eq(attachments.id, id))
      .returning();
    return saved;
  }

  /** A link to read the file with, good for the minutes asked for. */
  async download(row: AttachmentRow, minutes: number): Promise<PresignedUrl> {
    return this.storage.presignGet(row.storageKey, {
      expiresInSeconds: minutes * 60,
      filename: `${row.kind.toLowerCase()}.${EXTENSIONS[row.contentType] ?? 'bin'}`,
    });
  }

  /** The row, or 404. Whether the caller may see it is the module's own rule. */
  async get(id: string): Promise<AttachmentRow> {
    const [row] = await this.txHost.tx
      .select()
      .from(attachments)
      .where(eq(attachments.id, id));
    if (!row) throw new NotFoundError('attachment');
    return row;
  }

  /** Every attachment on one row, oldest first (ids are UUIDv7). */
  async of(ownerType: string, ownerId: string): Promise<AttachmentRow[]> {
    return this.txHost.tx
      .select()
      .from(attachments)
      .where(eq(attachments.ownerType, ownerType))
      .then((rows) => rows.filter((row) => row.ownerId === ownerId));
  }

  private async byClientUuid(
    clientUuid: string,
  ): Promise<AttachmentRow | undefined> {
    const [row] = await this.txHost.tx
      .select()
      .from(attachments)
      .where(eq(attachments.clientUuid, clientUuid));
    return row;
  }

  private async insert(input: PresignInput): Promise<AttachmentRow> {
    const id = uuidv7();
    const extension = EXTENSIONS[input.contentType] ?? 'bin';
    const [row] = await this.txHost.tx
      .insert(attachments)
      .values({
        id,
        kind: input.kind,
        ownerType: input.owner.type,
        ownerId: input.owner.id,
        // The owner is in the key, so an object tells you what it belongs to
        // even when it is found on its own in the bucket.
        storageKey: `${input.owner.type}/${input.owner.id}/${id}.${extension}`,
        contentType: input.contentType,
        bytes: input.bytes,
        sha256: input.sha256 ?? null,
        clientUuid: input.clientUuid,
        capturedAt: input.capturedAt ?? this.clock.now(),
        createdById: input.createdById,
      })
      .returning();
    return row;
  }
}
