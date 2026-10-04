// apps/backend/src/modules/sync/sync.module.ts · owner: Aniqa
// Replays offline outboxes exactly once; conflicts for 19c follow (ROO-44, ROO-45).
// Spec: specs/sync/spec.md. Tables: src/db/schema/sync.ts.
import { Module } from '@nestjs/common';
import { ExecutionModule } from '../execution';
import { LoadingModule } from '../loading';
import { SyncController } from './controllers/sync.controller';
import { SyncService } from './services/sync.service';

/**
 * Sync imports execution and loading (specs/sync/spec.md, depends-on) for the two appliers a
 * batch hands its events to, and nothing else: what an event does to a stop, a trip, an order or
 * a load line is those modules' business.
 */
@Module({
  imports: [ExecutionModule, LoadingModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
