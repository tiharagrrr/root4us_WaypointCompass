import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { ClockService } from '../clock/clock.service';
import type { PresignedUrl, PutOptions, StoragePort } from './storage.port';

/**
 * The keyless default, for a machine with no object store configured and for
 * the test suites: URLs are shaped and signed like the real thing, with the
 * expiry the caller asked for, but nothing is stored behind them.
 *
 * `exists` answers true, because there is nothing to look in: the "upload
 * never arrived" branch of `POST /attachments/{id}/complete` is only
 * reachable against a real store (Garage locally). Anything that must not
 * depend on that runs through `S3StorageAdapter`.
 */
@Injectable()
export class LocalStorageAdapter implements StoragePort {
  private readonly secret: string;
  private readonly base: string;

  constructor(
    config: AppConfig,
    private readonly clock: ClockService,
  ) {
    this.secret = config.auth.secret;
    this.base = `${config.storage.endpoint ?? 'http://localhost:9000'}/${config.storage.bucket}`;
  }

  presignPut(key: string, options: PutOptions): Promise<PresignedUrl> {
    return Promise.resolve(this.sign(key, 'PUT', options.expiresInSeconds));
  }

  presignGet(
    key: string,
    options: { expiresInSeconds: number },
  ): Promise<PresignedUrl> {
    return Promise.resolve(this.sign(key, 'GET', options.expiresInSeconds));
  }

  exists(): Promise<boolean> {
    return Promise.resolve(true);
  }

  private sign(key: string, method: string, seconds: number): PresignedUrl {
    const expiresAt = new Date(this.clock.now().getTime() + seconds * 1000);
    const expires = expiresAt.toISOString();
    const signature = createHmac('sha256', this.secret)
      .update(`${method}\n${key}\n${expires}`)
      .digest('hex')
      .slice(0, 32);
    const params = new URLSearchParams({
      method,
      expires,
      signature,
    });
    return { url: `${this.base}/${key}?${params}`, expiresAt };
  }
}
