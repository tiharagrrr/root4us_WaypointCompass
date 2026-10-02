import { Global, Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AttachmentsService } from './attachments.service';

/**
 * `platform.attachments` is core's table, so one service writes it and the
 * modules that keep files (execution, loading, receipt) call it rather than
 * each writing rows of their own (architecture rule 2).
 */
@Global()
@Module({
  imports: [StorageModule],
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
