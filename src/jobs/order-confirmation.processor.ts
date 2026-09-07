import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  OrderNotificationKind,
  OrderQueue,
  type OrderConfirmationJobData,
} from './order-jobs.constants.js';

@Injectable()
@Processor(OrderQueue.Name, { concurrency: 5 })
export class OrderConfirmationProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderConfirmationProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(
    job: Job<OrderConfirmationJobData, void, string>,
  ): Promise<void> {
    if (job.name !== OrderQueue.Confirm) {
      throw new UnrecoverableError(`Unsupported order job: ${job.name}`);
    }

    try {
      const order = await this.prisma.order.findUnique({
        where: { id: job.data.orderId },
        select: {
          id: true,
          orderNumber: true,
          user: { select: { email: true } },
        },
      });
      if (!order) {
        throw new UnrecoverableError('Order no longer exists');
      }

      // This is the delivery-provider boundary. A real mail/SMS adapter can be
      // injected here without changing checkout or queue orchestration.
      this.logger.log(`Confirmation prepared for order ${order.orderNumber}`);
      await this.prisma.orderNotificationOutbox.updateMany({
        where: {
          orderId: order.id,
          kind: OrderNotificationKind.Confirmation,
          completedAt: null,
        },
        data: { completedAt: new Date(), queuedAt: null, lastError: null },
      });
    } catch (error: unknown) {
      if (!(error instanceof UnrecoverableError)) {
        await this.prisma.orderNotificationOutbox.updateMany({
          where: {
            orderId: job.data.orderId,
            kind: OrderNotificationKind.Confirmation,
            completedAt: null,
          },
          data: {
            queuedAt: null,
            lastError: error instanceof Error ? error.message : 'Job failed',
          },
        });
      }
      throw error;
    }
  }
}
