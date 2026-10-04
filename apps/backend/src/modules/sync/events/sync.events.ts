/** `sync.batch_applied`: a device's batch was processed; counts only (specs/sync/spec.md, Events). */
export type SyncBatchAppliedEvent = {
  v: 1;
  batchId: string;
  deviceId: string;
  received: number;
  applied: number;
  duplicates: number;
  conflicts: number;
  rejected: number;
};
