import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { ClockService } from '../clock/clock.service';
import { LocalStorageAdapter } from './local-storage.adapter';
import { S3StorageAdapter } from './s3-storage.adapter';
import { STORAGE, type StoragePort } from './storage.port';

/**
 * One storage adapter for the whole API, chosen by the environment: S3 when
 * `S3_ENDPOINT` and its keys are set (Garage from `pnpm infra:up`, or any S3
 * in the cloud), and the keyless local default otherwise, so a fresh
 * checkout boots and the suites run with no object store.
 */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE,
      inject: [AppConfig, ClockService],
      useFactory: (config: AppConfig, clock: ClockService): StoragePort => {
        const s3 = config.storage;
        return s3.endpoint && s3.accessKeyId && s3.secretAccessKey
          ? new S3StorageAdapter(config, clock)
          : new LocalStorageAdapter(config, clock);
      },
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}
