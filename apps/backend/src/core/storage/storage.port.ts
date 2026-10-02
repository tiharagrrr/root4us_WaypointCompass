/**
 * Object storage behind one port, so the modules that keep files — proof of
 * delivery, load flag photos, issue photos — never speak S3 themselves. The
 * adapter is picked by `S3_ENDPOINT`: Garage locally, any S3 in the cloud,
 * and a keyless in-process default when nothing is configured, so the API
 * boots and the suites run with no object store at all.
 */
export interface PresignedUrl {
  url: string;
  /** When the link stops working, in server time. */
  expiresAt: Date;
}

export interface PutOptions {
  contentType: string;
  bytes?: number | null;
  expiresInSeconds: number;
  /** Checked by the store when it can, so a swapped file is refused. */
  sha256?: string | null;
}

export interface StoragePort {
  /** A URL the phone may PUT the file to, once, until it expires. */
  presignPut(key: string, options: PutOptions): Promise<PresignedUrl>;

  /** A URL to read the file with, for as long as it lasts. */
  presignGet(
    key: string,
    options: { expiresInSeconds: number; filename?: string },
  ): Promise<PresignedUrl>;

  /** Whether the object is actually in the store. */
  exists(key: string): Promise<boolean>;
}

/** The DI token, because a port is an interface and interfaces have none. */
export const STORAGE = Symbol('STORAGE');
