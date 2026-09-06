export interface PresignedProductUploadResult {
  /** The presigned PUT URL the client should upload to. */
  uploadUrl: string;

  /** The R2 object key (e.g. `products/{id}/{uuid}.webp`). */
  objectKey: string;

  /** The public CDN URL where the file will be accessible after upload. */
  publicUrl: string;

  /** Headers the browser must send with the direct R2 PUT. */
  uploadHeaders: Record<string, string>;
}
