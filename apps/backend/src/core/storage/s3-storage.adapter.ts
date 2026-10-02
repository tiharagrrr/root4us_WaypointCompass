import { Injectable } from '@nestjs/common';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfig } from '../../config/app-config';
import { ClockService } from '../clock/clock.service';
import { DependencyUnavailableError } from '../errors/domain-errors';
import type { PresignedUrl, PutOptions, StoragePort } from './storage.port';

/**
 * S3 for real: Garage locally (`pnpm infra:up`), any S3-compatible store in
 * the cloud. Only presigned URLs leave the API — the phone uploads straight
 * to the store and the browser downloads straight from it, so proof-of-
 * delivery photos never pass through the API at all.
 */
@Injectable()
export class S3StorageAdapter implements StoragePort {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    config: AppConfig,
    private readonly clock: ClockService,
  ) {
    const s3 = config.storage;
    this.bucket = s3.bucket;
    this.client = new S3Client({
      region: s3.region,
      endpoint: s3.endpoint,
      forcePathStyle: s3.forcePathStyle,
      ...(s3.accessKeyId &&
        s3.secretAccessKey && {
          credentials: {
            accessKeyId: s3.accessKeyId,
            secretAccessKey: s3.secretAccessKey,
          },
        }),
    });
  }

  async presignPut(key: string, options: PutOptions): Promise<PresignedUrl> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: options.contentType,
        ...(options.bytes != null && { ContentLength: options.bytes }),
      }),
      { expiresIn: options.expiresInSeconds },
    );
    return { url, expiresAt: this.expiry(options.expiresInSeconds) };
  }

  async presignGet(
    key: string,
    options: { expiresInSeconds: number; filename?: string },
  ): Promise<PresignedUrl> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(options.filename && {
          ResponseContentDisposition: `inline; filename="${options.filename}"`,
        }),
      }),
      { expiresIn: options.expiresInSeconds },
    );
    return { url, expiresAt: this.expiry(options.expiresInSeconds) };
  }

  /**
   * Whether the object is there. A 404 means it is not, and anything else
   * means the store could not answer — an unreachable or half-configured
   * bucket must not be reported as "your upload never arrived", or the phone
   * would be told to upload a file it already uploaded.
   */
  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status === 404 || status === 403) return false;
      throw new DependencyUnavailableError('object storage');
    }
  }

  /**
   * The demo clock decides what a response says expires when, so a criterion
   * can state 04:31:00; the signature itself runs on real time, because the
   * store is the one checking it.
   */
  private expiry(seconds: number): Date {
    return new Date(this.clock.now().getTime() + seconds * 1000);
  }
}
