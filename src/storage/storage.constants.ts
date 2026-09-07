export const ALLOWED_IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;

export type AllowedImageContentType =
  (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number];

/** 10 MB — maximum file size for presigned uploads. */
export const MAX_PRODUCT_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

/** Immutable because every upload receives a unique object key. */
export const PRODUCT_IMAGE_CACHE_CONTROL =
  'public, max-age=31536000, immutable';

/** 10 minutes — default presigned URL validity window. */
export const DEFAULT_PRESIGNED_TTL_SECONDS = 600;
