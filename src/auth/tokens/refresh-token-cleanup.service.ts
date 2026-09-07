import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;
const CLEANUP_BATCH_SIZE = 500;

@Injectable()
export class RefreshTokenCleanupService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RefreshTokenCleanupService.name);
  private cleanupTimer?: NodeJS.Timeout;
  private cleanupInProgress = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    void this.cleanupExpiredTokens();
    this.cleanupTimer = setInterval(
      () => void this.cleanupExpiredTokens(),
      CLEANUP_INTERVAL_MS,
    );
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  private async cleanupExpiredTokens(): Promise<void> {
    if (this.cleanupInProgress) return;
    this.cleanupInProgress = true;

    try {
      let deleted = 0;
      const cutoff = new Date();

      for (let batch = 0; batch < 100; batch += 1) {
        const candidates = await this.prisma.refreshToken.findMany({
          where: {
            expiresAt: { lte: cutoff },
            // Delete leaf tokens first so the self-referencing rotation
            // foreign key never prevents cleanup of an entire token family.
            previousTokens: { none: {} },
          },
          orderBy: { expiresAt: 'asc' },
          take: CLEANUP_BATCH_SIZE,
          select: { id: true },
        });
        if (candidates.length === 0) break;

        const result = await this.prisma.refreshToken.deleteMany({
          where: { id: { in: candidates.map(({ id }) => id) } },
        });
        deleted += result.count;
        if (result.count === 0) break;
      }

      if (deleted > 0) {
        this.logger.log(`Removed ${deleted} expired refresh tokens`);
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Refresh-token cleanup failed: ${
          error instanceof Error ? error.message : 'unknown database error'
        }`,
      );
    } finally {
      this.cleanupInProgress = false;
    }
  }
}
