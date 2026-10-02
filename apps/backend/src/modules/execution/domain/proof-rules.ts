import type { DeliveryOutcome } from '@waypoint/shared';
import { ValidationError } from '../../../core/errors/domain-errors';
import type { FieldEvent } from './field-event';

/** One field is wrong, named the way D4 and D5 expect. */
export const fieldError = (field: string, code: string, message: string) =>
  new ValidationError([{ field, code, message }]);

/** The outcomes that finish a stop well enough to need proof. */
const NEEDS_PROOF = new Set<DeliveryOutcome>(['DELIVERED', 'PARTIAL']);

/**
 * What a recorded outcome must carry before it is written (AC-EXE-10):
 *
 * - DELIVERED and PARTIAL need a receiver's name and either a signature or a
 *   photo, because that is the proof the store and the audit trail rely on;
 * - FAILED needs an outcome and a note, because somebody has to decide what
 *   happens to the order next.
 *
 * It throws rather than returning a verdict: an event that fails here is
 * never appended, so the stop keeps the status it had. Pure, so the same
 * check runs for an online shortcut and for a replay through `/sync`.
 */
export function assertProof(event: FieldEvent): void {
  if (event.type === 'DELIVERED' || event.type === 'PARTIAL') {
    if (!event.receiverName?.trim())
      throw fieldError('receiverName', 'required', 'Who took the delivery?');
    if (!event.attachmentUuids?.length)
      throw fieldError(
        'attachmentUuids',
        'required',
        'Add a signature or a photo',
      );
    if (event.type === 'PARTIAL' && !event.note?.trim())
      throw fieldError('note', 'required', 'Say what was short and why');
  }

  if (event.type === 'FAILED') {
    if (!event.outcome)
      throw fieldError('outcome', 'required', 'Why did it fail?');
    if (NEEDS_PROOF.has(event.outcome))
      throw fieldError(
        'outcome',
        'invalid',
        'A failed stop cannot be DELIVERED or PARTIAL',
      );
    if (!event.note?.trim())
      throw fieldError('note', 'required', 'Add a note for the dispatcher');
  }

  if (event.type === 'CANT_RUN' && !event.reasonCode)
    throw fieldError('reasonCode', 'required', 'A reason is required');
}

/**
 * The outcome a DELIVERED or PARTIAL event records. DELIVERED is always
 * DELIVERED; PARTIAL may name why it was short (damaged, refused), and falls
 * back to PARTIAL when the phone says only that it was.
 */
export function outcomeOf(event: FieldEvent): DeliveryOutcome {
  if (event.type === 'DELIVERED') return 'DELIVERED';
  if (event.type === 'PARTIAL') return 'PARTIAL';
  if (!event.outcome)
    throw fieldError('outcome', 'required', 'Why did it fail?');
  return event.outcome;
}
