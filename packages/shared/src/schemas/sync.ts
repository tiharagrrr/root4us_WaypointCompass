import { z } from 'zod';
import { STOP_EVENT_TYPES } from '../domain';

/**
 * Offline outbox contract for POST /api/v1/sync. Every action carries a
 * client-generated UUID so replays after reconnect are idempotent, and the
 * device time so late-synced events can be flagged rather than reordered.
 */
export const stopEventSchema = z.object({
  clientUuid: z.uuid(),
  stopId: z.uuid(),
  type: z.enum(STOP_EVENT_TYPES),
  occurredAt: z.iso.datetime({ offset: true }),
  deviceId: z.string().min(1).optional(),
  reasonCode: z.string().min(1).optional(),
  note: z.string().max(2000).optional(),
  deliveredUnits: z.number().int().nonnegative().optional(),
  receiverName: z.string().max(200).optional(),
});
export type StopEventInput = z.infer<typeof stopEventSchema>;

export const syncBatchSchema = z.object({
  deviceId: z.string().min(1),
  lastServerVersion: z.number().int().nonnegative().optional(),
  events: z.array(stopEventSchema).max(500),
});
export type SyncBatch = z.infer<typeof syncBatchSchema>;
