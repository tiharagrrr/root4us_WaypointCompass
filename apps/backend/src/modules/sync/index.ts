// The sync module's public surface: other modules import from this file only.
export { SyncModule } from './sync.module';
export { SyncService, type SyncOutcome } from './services/sync.service';
export { SYNC_EVENTS, SYNC_LOGS, SYNC_VERSION } from './sync.constants';
export type { SyncBatchAppliedEvent } from './events/sync.events';
