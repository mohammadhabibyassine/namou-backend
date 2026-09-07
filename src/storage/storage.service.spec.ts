import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { StorageConfiguration } from '../config/storage.config.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { PRODUCT_IMAGE_CACHE_CONTROL } from './storage.constants.js';
import { StorageService } from './storage.service.js';

const sendMock = vi.fn();
const getSignedUrlMock = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class MockS3Client {
    send = sendMock;
  },
  PutObjectCommand: class MockPutObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  HeadObjectCommand: class MockHeadObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  DeleteObjectsCommand: class MockDeleteObjectsCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrlMock(...args),
}));

vi.mock('node:crypto', () => ({
  randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
}));

const PRODUCT_ID = '550e8400-e29b-41d4-a716-446655440000';
const OBJECT_KEY =
  'products/550e8400-e29b-41d4-a716-446655440000/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp';
const TEST_CONFIG: StorageConfiguration = {
  accountId: 'test-account-id',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key',
  bucketName: 'test-bucket',
  publicUrl: 'https://cdn.test.com/',
  presignedUrlTtlSeconds: 600,
} as StorageConfiguration;

describe('StorageService', () => {
  const productFindFirst = vi.fn();
  const productImageCount = vi.fn();
  const queryRaw = vi.fn();
  const transaction = vi.fn();
  const tx = {
    $queryRaw: queryRaw,
    productImage: { count: productImageCount },
  };
  const prisma = {
    product: { findFirst: productFindFirst },
    productImage: { count: productImageCount },
    $transaction: transaction,
  } as unknown as PrismaService;
  let service: StorageService;

  beforeEach(() => {
    vi.clearAllMocks();
    productFindFirst.mockResolvedValue({ id: PRODUCT_ID });
    productImageCount.mockResolvedValue(0);
    queryRaw.mockResolvedValue([{ id: PRODUCT_ID }]);
    transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    getSignedUrlMock.mockResolvedValue(
      'https://test-bucket.r2.cloudflarestorage.com/signed-url',
    );
    service = new StorageService(TEST_CONFIG, prisma);
  });

  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['image/avif', 'avif'],
  ] as const)(
    'presigns a product-scoped %s upload',
    async (contentType, ext) => {
      const result = await service.createProductUploadUrl({
        productId: PRODUCT_ID,
        contentType,
        fileSizeBytes: 1_024,
      });

      expect(result.objectKey).toBe(
        `products/${PRODUCT_ID}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.${ext}`,
      );
      expect(result.publicUrl).toBe(`https://cdn.test.com/${result.objectKey}`);
      expect(result.uploadHeaders).toEqual({
        'Content-Type': contentType,
        'Cache-Control': PRODUCT_IMAGE_CACHE_CONTROL,
      });
      expect(getSignedUrlMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          input: expect.objectContaining({
            Bucket: 'test-bucket',
            ContentLength: 1_024,
            ContentType: contentType,
            CacheControl: PRODUCT_IMAGE_CACHE_CONTROL,
            Metadata: { productId: PRODUCT_ID },
          }),
        }),
        { expiresIn: 600 },
      );
    },
  );

  it('does not sign uploads for missing products', async () => {
    productFindFirst.mockResolvedValue(null);

    await expect(
      service.createProductUploadUrl({
        productId: PRODUCT_ID,
        contentType: 'image/png',
        fileSizeBytes: 100,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it('verifies an uploaded object before returning its public URL', async () => {
    sendMock.mockResolvedValue({
      ContentLength: 1_024,
      ContentType: 'image/webp',
      CacheControl: PRODUCT_IMAGE_CACHE_CONTROL,
    });

    await expect(
      service.verifyProductObject(PRODUCT_ID, OBJECT_KEY),
    ).resolves.toBe(`https://cdn.test.com/${OBJECT_KEY}`);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { Bucket: 'test-bucket', Key: OBJECT_KEY },
      }),
    );
  });

  it('rejects keys outside the product namespace without contacting R2', async () => {
    await expect(
      service.verifyProductObject(PRODUCT_ID, 'products/other/image.webp'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      {
        ContentLength: 11 * 1024 * 1024,
        ContentType: 'image/png',
        CacheControl: PRODUCT_IMAGE_CACHE_CONTROL,
      },
    ],
    [
      {
        ContentLength: 1_024,
        ContentType: 'application/pdf',
        CacheControl: PRODUCT_IMAGE_CACHE_CONTROL,
      },
    ],
    [{ ContentLength: 1_024, ContentType: 'image/png' }],
  ])('rejects unsafe uploaded object metadata', async (metadata) => {
    sendMock.mockResolvedValue(metadata);
    await expect(
      service.verifyProductObject(PRODUCT_ID, OBJECT_KEY),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deletes failed uploads when they are not attached', async () => {
    sendMock.mockResolvedValue({});

    await service.deleteUnattachedProductObjects(PRODUCT_ID, [OBJECT_KEY]);

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          Bucket: 'test-bucket',
          Delete: { Objects: [{ Key: OBJECT_KEY }], Quiet: true },
        },
      }),
    );
    expect(queryRaw).toHaveBeenCalled();
  });

  it('never deletes an attached catalog image', async () => {
    productImageCount.mockResolvedValue(1);

    await expect(
      service.deleteUnattachedProductObjects(PRODUCT_ID, [OBJECT_KEY]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
