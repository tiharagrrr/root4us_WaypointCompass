// apps/backend/src/modules/realtime/realtime.module.ts · owner: Nimesha
// One authenticated SSE stream per signed-in client.
// Spec: specs/realtime/spec.md. No tables of its own.
import { Module } from '@nestjs/common';
import { ExecutionModule } from '../execution';
import { StreamsController } from './controllers/streams.controller';
import { EventStreamService } from './event-stream.service';
import { RealtimeHub } from './realtime.hub';

@Module({
  imports: [ExecutionModule],
  controllers: [StreamsController],
  providers: [RealtimeHub, EventStreamService],
  exports: [RealtimeHub],
})
export class RealtimeModule {}
