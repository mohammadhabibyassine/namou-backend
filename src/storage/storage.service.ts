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
import { Prisma } from '../generated/prisma/client.js';
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
    if (
      params.fileSizeBytes < 1 ||
      params.fileSizeBytes > MAX_PRODUCT_IMAGE_SIZE_BYTES
    ) {
      throw new BadRequestException(
        'Product image must be between 1 byte and 10 MB',
      );
    }
    await this.assertProductExists(params.productId);

    const extension = CONTENT_TYPE_TO_EXTENSION[params.contentType];
    const objectKey = `products/${params.productId}/${randomUUID()}.${extension}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: objectKey,
      ContentType: params.contentType,
      // Do not sign ContentLength: browsers cannot set this forbidden header.
      // The uploaded size is verified with HeadObject before attachment.
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

    const pendingDeletion =
      await this.prisma.storageObjectDeletionOutbox.findUnique({
        where: {
          productId_objectKey: { productId, objectKey },
        },
        select: { completedAt: true },
      });
    if (pendingDeletion?.completedAt === null) {
      throw new BadRequestException(
        'This uploaded product image is pending cleanup',
      );
    }

    let object: HeadObjectCommandOutput;
    try {
      object = await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: objectKey,
        }),
      );
    } catch {
      throw new BadRequestException(
        'Uploaded product image could not be found',
      );
    }

    const contentType = object.ContentType?.split(';', 1)[0]?.trim();
    if (
      !contentType ||
      !ALLOWED_IMAGE_CONTENT_TYPES.includes(
        contentType as AllowedImageContentType,
      )
    ) {
      throw new BadRequestException(
        'Uploaded product image type is not allowed',
      );
    }
    if (
      !object.ContentLength ||
      object.ContentLength > MAX_PRODUCT_IMAGE_SIZE_BYTES
    ) {
      throw new BadRequestException('Uploaded product image exceeds 10 MB');
    }
    if (object.CacheControl !== PRODUCT_IMAGE_CACHE_CONTROL) {
      throw new BadRequestException(
        'Uploaded product image cache policy is invalid',
      );
    }

    return this.buildPublicUrl(objectKey);
  }

  /** Cleans up failed uploads without allowing attached catalog media deletion. */
  async deleteUnattachedProductObjects(
    productId: string,
    objectKeys: string[],
  ): Promise<void> {
    const uniqueKeys = [...new Set(objectKeys)];
    uniqueKeys.forEach((key) => this.assertProductObjectKey(productId, key));
    if (uniqueKeys.length === 0) return;

    await this.prisma.$transaction(async (tx) => {
      await this.lockProduct(tx, productId);
      const imageUrls = uniqueKeys.map((key) => this.buildPublicUrl(key));
      const attachedCount = await tx.productImage.count({
        where: { productId, imageUrl: { in: imageUrls } },
      });
      if (attachedCount > 0) {
        throw new BadRequestException(
          'Attached product images cannot be deleted',
        );
      }

      await tx.storageObjectDeletionOutbox.createMany({
        data: uniqueKeys.map((objectKey) => ({ productId, objectKey })),
        skipDuplicates: true,
      });
    });
  }

  getProductObjectKey(productId: string, imageUrl: string): string | null {
    const prefix = `${this.publicUrl}/products/${productId}/`;
    if (!imageUrl.startsWith(prefix)) return null;

    const objectKey = imageUrl.slice(this.publicUrl.length + 1);
    try {
      this.assertProductObjectKey(productId, objectKey);
      return objectKey;
    } catch {
      return null;
    }
  }

  async isProductObjectAttached(
    productId: string,
    objectKey: string,
  ): Promise<boolean> {
    return (
      (await this.prisma.productImage.count({
        where: {
          productId,
          imageUrl: this.buildPublicUrl(objectKey),
        },
      })) > 0
    );
  }

  async deleteProductObject(
    productId: string,
    objectKey: string,
  ): Promise<void> {
    this.assertProductObjectKey(productId, objectKey);
    await this.s3.send(
      new DeleteObjectsCommand({
        Bucket: this.bucketName,
        Delete: { Objects: [{ Key: objectKey }], Quiet: true },
      }),
    );
  }

  private async lockProduct(
    tx: Prisma.TransactionClient,
    productId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id
      FROM products
      WHERE id = ${productId}::uuid AND deleted_at IS NULL
      FOR UPDATE
    `);
    if (!rows[0]) throw new NotFoundException('Product not found');
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
