import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  OrderQueue,
  type OrderConfirmationJobData,
} from './order-jobs.constants.js';

@Injectable()
export class OrderJobsService {
  private readonly logger = new Logger(OrderJobsService.name);

  constructor(
    @InjectQueue(OrderQueue.Name)
    private readonly queue: Queue<OrderConfirmationJobData>,
  ) {}

  async enqueueConfirmation(orderId: string): Promise<void> {
    try {
      await this.queue.add(
        OrderQueue.Confirm,
        { orderId },
        { jobId: `order-confirmation-${orderId}` },
      );
    } catch (error: unknown) {
      // PostgreSQL has already committed the order. Without adding an outbox
      // table to the finalized schema, a Redis outage cannot be made atomic
      // with checkout, so it must never turn a successful order into an HTTP
      // failure. Production alerting should surface this log for redelivery.
      this.logger.error(
        `Could not enqueue confirmation for order ${orderId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
