import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Queue } from 'bullmq';
import {
  OrderNotificationKind,
  OrderQueue,
  type OrderConfirmationJobData,
} from './order-jobs.constants.js';

@Injectable()
export class OrderJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderJobsService.name);
  private retryTimer?: NodeJS.Timeout;

  constructor(
    @InjectQueue(OrderQueue.Name)
    private readonly queue: Queue<OrderConfirmationJobData>,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    void this.publishPendingConfirmations();
    this.retryTimer = setInterval(
      () => void this.publishPendingConfirmations(),
      10_000,
    );
    this.retryTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.retryTimer) clearInterval(this.retryTimer);
  }

  async enqueueConfirmation(orderId: string): Promise<void> {
    const outbox = await this.prisma.orderNotificationOutbox.findUnique({
      where: {
        orderId_kind: {
          orderId,
          kind: OrderNotificationKind.Confirmation,
        },
      },
      select: { id: true },
    });
    if (outbox) {
      await this.publishOutbox(outbox.id, orderId);
      return;
    }

    // Keep compatibility with orders created before the outbox migration.
    try {
      await this.publishJob(orderId);
    } catch (error: unknown) {
      this.logger.error(
        `Could not enqueue legacy confirmation for order ${orderId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async publishPendingConfirmations(): Promise<void> {
    try {
      const pending = await this.prisma.orderNotificationOutbox.findMany({
        where: {
          kind: OrderNotificationKind.Confirmation,
          completedAt: null,
          OR: [
            { queuedAt: null },
            { queuedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: { id: true, orderId: true },
      });
      for (const item of pending) {
        await this.publishOutbox(item.id, item.orderId);
      }
    } catch (error: unknown) {
      this.logger.error(
        'Could not publish pending order confirmations',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async publishOutbox(
    outboxId: string,
    orderId: string,
  ): Promise<void> {
    try {
      await this.publishJob(orderId);
      await this.prisma.orderNotificationOutbox.updateMany({
        where: { id: outboxId, completedAt: null },
        data: {
          queuedAt: new Date(),
          attempts: { increment: 1 },
          lastError: null,
        },
      });
    } catch (error: unknown) {
      try {
        await this.prisma.orderNotificationOutbox.updateMany({
          where: { id: outboxId, completedAt: null },
          data: {
            queuedAt: null,
            lastError:
              error instanceof Error ? error.message : 'Queue unavailable',
          },
        });
      } catch (recordError: unknown) {
        this.logger.error(
          `Could not record confirmation publication failure for ${orderId}`,
          recordError instanceof Error ? recordError.stack : undefined,
        );
      }
      this.logger.error(
        `Could not enqueue confirmation for order ${orderId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private publishJob(orderId: string): Promise<unknown> {
    return this.queue.add(
      OrderQueue.Confirm,
      { orderId },
      { jobId: `order-confirmation-${orderId}` },
    );
  }
}
