import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from './storage.service.js';

const CLEANUP_INTERVAL_MS = 30_000;
const CLAIM_TIMEOUT_MS = 5 * 60_000;
const CLEANUP_BATCH_SIZE = 50;

@Injectable()
export class StorageCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageCleanupService.name);
  private cleanupTimer?: NodeJS.Timeout;
  private cleanupInProgress = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    void this.processPendingDeletes();
    this.cleanupTimer = setInterval(
      () => void this.processPendingDeletes(),
      CLEANUP_INTERVAL_MS,
    );
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  private async processPendingDeletes(): Promise<void> {
    if (this.cleanupInProgress) return;
    this.cleanupInProgress = true;

    try {
      const retryBefore = new Date(Date.now() - CLAIM_TIMEOUT_MS);
      const candidates = await this.prisma.storageObjectDeletionOutbox.findMany(
        {
          where: {
            completedAt: null,
            OR: [{ processingAt: null }, { processingAt: { lt: retryBefore } }],
          },
          orderBy: { createdAt: 'asc' },
          take: CLEANUP_BATCH_SIZE,
          select: { id: true, productId: true, objectKey: true },
        },
      );

      for (const candidate of candidates) {
        const claimed =
          await this.prisma.storageObjectDeletionOutbox.updateMany({
            where: {
              id: candidate.id,
              completedAt: null,
              OR: [
                { processingAt: null },
                { processingAt: { lt: retryBefore } },
              ],
            },
            data: {
              processingAt: new Date(),
              attempts: { increment: 1 },
            },
          });
        if (claimed.count !== 1) continue;

        try {
          const attached = await this.storage.isProductObjectAttached(
            candidate.productId,
            candidate.objectKey,
          );
          if (attached) {
            await this.markCompleted(
              candidate.id,
              'Skipped: object is attached',
            );
            continue;
          }

          await this.storage.deleteProductObject(
            candidate.productId,
            candidate.objectKey,
          );
          await this.markCompleted(candidate.id);
        } catch (error: unknown) {
          await this.prisma.storageObjectDeletionOutbox.updateMany({
            where: { id: candidate.id, completedAt: null },
            data: {
              processingAt: null,
              lastError:
                error instanceof Error
                  ? error.message
                  : 'Object deletion failed',
            },
          });
          this.logger.warn(
            `Could not delete product object ${candidate.objectKey}: ${
              error instanceof Error ? error.message : 'unknown storage error'
            }`,
          );
        }
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Storage cleanup failed: ${
          error instanceof Error ? error.message : 'unknown database error'
        }`,
      );
    } finally {
      this.cleanupInProgress = false;
    }
  }

  private markCompleted(id: string, lastError: string | null = null) {
    return this.prisma.storageObjectDeletionOutbox.updateMany({
      where: { id, completedAt: null },
      data: {
        completedAt: new Date(),
        processingAt: null,
        lastError,
      },
    });
  }
}
