import { registerAs, type ConfigType } from '@nestjs/config';

export const storageConfig = registerAs('storage', () => ({
  accountId: process.env.R2_ACCOUNT_ID as string,
  accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
  bucketName: process.env.R2_BUCKET_NAME as string,
  publicUrl: process.env.R2_PUBLIC_URL as string,
  presignedUrlTtlSeconds: Number(
    process.env.R2_PRESIGNED_URL_TTL_SECONDS ?? 600,
  ),
}));

export type StorageConfiguration = ConfigType<typeof storageConfig>;
