import { attachmentsComplete, attachmentsPresign, type PresignAttachmentDtoKind } from '@compass/api-client'
import { db, uuidv7, type AttachmentRow, type CompassDb } from '@/offline'

/**
 * Proof of delivery, queued like everything else a driver taps.
 *
 * A signature or a photo is a Blob, not JSON, so it cannot ride in the outbox batch. It goes into
 * `db.attachments` under its own clientUuid, the stop event refers to it by that id, and this loop
 * presigns, uploads and completes it on its own retry (specs/execution/spec.md, AC-EXE-16). The two
 * halves are independent on purpose: the event is the record of what happened and must land even if
 * the photo takes until the depot's Wi-Fi to follow it.
 */
export interface QueuedAttachment {
  clientUuid: string
  kind: AttachmentRow['kind']
}

/** Put a Blob on the phone and hand back the id the event will carry. */
export async function queueAttachment(
  blob: Blob,
  kind: AttachmentRow['kind'],
  database: CompassDb = db,
): Promise<QueuedAttachment> {
  const clientUuid = uuidv7()
  await database.attachments.add({
    clientUuid,
    blob,
    contentType: blob.type || (kind === 'signature' ? 'image/png' : 'image/jpeg'),
    kind,
    status: 'pending',
    attempts: 0,
    attachmentId: null,
  })
  return { clientUuid, kind }
}

/** sha256 of the bytes, which presign takes so the server can tell a retry from a new file. */
async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** The server's kinds; a driver's photo on D4 is proof of delivery, on D5 it is the exception. */
const KINDS = { signature: 'SIGNATURE', photo: 'POD_PHOTO' } as const

export interface FlushOptions {
  database?: CompassDb
  /** Injected in tests. */
  upload?: (url: string, blob: Blob, contentType: string) => Promise<void>
  /** D5 and D8 send the same Blob under their own kind. */
  kinds?: Record<AttachmentRow['kind'], PresignAttachmentDtoKind>
}

const putObject = async (url: string, blob: Blob, contentType: string): Promise<void> => {
  const response = await fetch(url, { method: 'PUT', body: blob, headers: { 'content-type': contentType } })
  if (!response.ok) throw new Error(`upload failed: ${response.status}`)
}

/**
 * Push every pending attachment at the owning stop. Each one is attempted on its own: a photo that
 * fails leaves the others alone and stays queued with its attempt count, exactly like the outbox.
 * Called after the stop's event is queued, and safe to call again at any time.
 */
export async function flushAttachments(
  owner: { type: 'stop' | 'trip'; id: string },
  options: FlushOptions = {},
): Promise<void> {
  const { database = db, upload = putObject, kinds = KINDS } = options
  const pending = await database.attachments.where('status').equals('pending').toArray()

  for (const row of pending) {
    try {
      await database.attachments.update(row.clientUuid, { status: 'uploading' })
      const presigned = await attachmentsPresign({
        kind: kinds[row.kind],
        contentType: row.contentType,
        bytes: row.blob.size,
        sha256: await sha256(row.blob),
        clientUuid: row.clientUuid,
        owner: { type: owner.type, id: owner.id },
      })
      const { id, upload: target } = presigned.data
      if (!target) throw new Error('presign returned no upload url')
      await upload(target.url, row.blob, row.contentType)
      await attachmentsComplete(id, {})
      await database.attachments.update(row.clientUuid, { status: 'uploaded', attachmentId: id })
    } catch {
      // Keep the bytes and try again later; the stop event has already been recorded without them.
      await database.attachments.update(row.clientUuid, {
        status: 'pending',
        attempts: row.attempts + 1,
      })
    }
  }
}
