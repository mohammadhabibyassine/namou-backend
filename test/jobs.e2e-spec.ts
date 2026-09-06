import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { JobsModule } from '../src/jobs/jobs.module.js';
import {
  OrderQueue,
  type OrderConfirmationJobData,
} from '../src/jobs/order-jobs.constants.js';
import { OrderJobsService } from '../src/jobs/order-jobs.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('BullMQ order jobs (e2e)', () => {
  let app: INestApplication;
  let queue: Queue<OrderConfirmationJobData>;
  let orderJobs: OrderJobsService;
  const findUnique = vi.fn();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [JobsModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ order: { findUnique } })
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    queue = app.get(getQueueToken(OrderQueue.Name));
    orderJobs = app.get(OrderJobsService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('moves a confirmation job through Redis and the Nest worker', async () => {
    const orderId = randomUUID();
    const jobId = `order-confirmation-${orderId}`;
    findUnique.mockResolvedValue({
      id: orderId,
      orderNumber: `ORD-${orderId.slice(0, 8)}`,
      user: { email: 'queue-test@example.com' },
    });

    await orderJobs.enqueueConfirmation(orderId);
    const job = await queue.getJob(jobId);
    expect(job).not.toBeNull();
    if (!job) throw new Error('Confirmation job was not created');

    await vi.waitFor(
      async () => expect(await job.getState()).toBe('completed'),
      { timeout: 5_000, interval: 50 },
    );
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: orderId } }),
    );
    await job.remove();
  });
});
