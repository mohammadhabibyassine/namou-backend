import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import {
  storageConfig,
  type StorageConfiguration,
} from '../config/storage.config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ALLOWED_IMAGE_CONTENT_TYPES,
  MAX_PRODUCT_IMAGE_SIZE_BYTES,
  PRODUCT_IMAGE_CACHE_CONTROL,
  type AllowedImageContentType,
} from './storage.constants.js';
import type { PresignedProductUploadResult } from './storage.types.js';

const CONTENT_TYPE_TO_EXTENSION: Record<AllowedImageContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  private readonly bucketName: string;
  private readonly publicUrl: string;
  private readonly presignedTtl: number;

  constructor(
    @Inject(storageConfig.KEY) private readonly config: StorageConfiguration,
    private readonly prisma: PrismaService,
  ) {
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    this.bucketName = config.bucketName;
    this.publicUrl = config.publicUrl.replace(/\/+$/, '');
    this.presignedTtl = config.presignedUrlTtlSeconds;
  }

  /**
   * Generates a presigned PUT URL that allows the client to upload a file
   * directly to R2 without proxying bytes through the backend.
   */
  async createProductUploadUrl(params: {
    productId: string;
    contentType: AllowedImageContentType;
    fileSizeBytes: number;
  }): Promise<PresignedProductUploadResult> {
    await this.assertProductExists(params.productId);

    const extension = CONTENT_TYPE_TO_EXTENSION[params.contentType];
    const objectKey = `products/${params.productId}/${randomUUID()}.${extension}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: objectKey,
      ContentType: params.contentType,
      ContentLength: params.fileSizeBytes,
      CacheControl: PRODUCT_IMAGE_CACHE_CONTROL,
      Metadata: { productId: params.productId },
    });

    const uploadUrl = await getSignedUrl(this.s3, command, {
      expiresIn: this.presignedTtl,
    });

    return {
      uploadUrl,
      objectKey,
      publicUrl: `${this.publicUrl}/${objectKey}`,
      uploadHeaders: {
        'Content-Type': params.contentType,
        'Cache-Control': PRODUCT_IMAGE_CACHE_CONTROL,
      },
    };
  }

  /** Verifies object metadata before its public URL enters the catalog. */
  async verifyProductObject(
    productId: string,
    objectKey: string,
  ): Promise<string> {
    this.assertProductObjectKey(productId, objectKey);

    let object: HeadObjectCommandOutput;
    try {
      object = await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: objectKey,
        }),
      );
    } catch {
      throw new BadRequestException('Uploaded product image could not be found');
    }

    const contentType = object.ContentType?.split(';', 1)[0]?.trim();
    if (
      !contentType ||
      !ALLOWED_IMAGE_CONTENT_TYPES.includes(
        contentType as AllowedImageContentType,
      )
    ) {
      throw new BadRequestException('Uploaded product image type is not allowed');
    }
    if (
      !object.ContentLength ||
      object.ContentLength > MAX_PRODUCT_IMAGE_SIZE_BYTES
    ) {
      throw new BadRequestException('Uploaded product image exceeds 10 MB');
    }
    if (object.CacheControl !== PRODUCT_IMAGE_CACHE_CONTROL) {
      throw new BadRequestException('Uploaded product image cache policy is invalid');
    }

    return this.buildPublicUrl(objectKey);
  }

  /** Cleans up failed uploads without allowing attached catalog media deletion. */
  async deleteUnattachedProductObjects(
    productId: string,
    objectKeys: string[],
  ): Promise<void> {
    await this.assertProductExists(productId);
    const uniqueKeys = [...new Set(objectKeys)];
    uniqueKeys.forEach((key) => this.assertProductObjectKey(productId, key));
    if (uniqueKeys.length === 0) return;

    const imageUrls = uniqueKeys.map((key) => this.buildPublicUrl(key));
    const attachedCount = await this.prisma.productImage.count({
      where: { productId, imageUrl: { in: imageUrls } },
    });
    if (attachedCount > 0) {
      throw new BadRequestException('Attached product images cannot be deleted');
    }

    await this.s3.send(
      new DeleteObjectsCommand({
        Bucket: this.bucketName,
        Delete: {
          Objects: uniqueKeys.map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
  }

  /**
   * Constructs the public CDN URL for a given object key.
   */
  buildPublicUrl(objectKey: string): string {
    return `${this.publicUrl}/${objectKey}`;
  }

  private async assertProductExists(productId: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');
  }

  private assertProductObjectKey(productId: string, objectKey: string): void {
    const pattern = new RegExp(
      `^products/${productId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:jpg|png|webp|avif)$`,
      'i',
    );
    if (!pattern.test(objectKey)) {
      throw new BadRequestException('Invalid product image object key');
    }
  }
}
