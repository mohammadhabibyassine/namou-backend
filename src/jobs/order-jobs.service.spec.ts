import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { PrismaService } from '../prisma/prisma.service.js';
import { OrderQueue } from './order-jobs.constants.js';
import { OrderJobsService } from './order-jobs.service.js';

describe('OrderJobsService', () => {
  const loggerError = vi
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
  const add = vi.fn();
  const queue = { add } as unknown as Queue;
  const findUnique = vi.fn();
  const findMany = vi.fn();
  const updateMany = vi.fn();
  const prisma = {
    orderNotificationOutbox: { findUnique, findMany, updateMany },
  } as unknown as PrismaService;
  const service = new OrderJobsService(queue, prisma);

  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue(null);
    findMany.mockResolvedValue([]);
    updateMany.mockResolvedValue({ count: 1 });
  });

  afterAll(() => loggerError.mockRestore());

  it('uses a deterministic non-numeric job ID for retry-safe publication', async () => {
    add.mockResolvedValue({ id: 'job-id' });

    await service.enqueueConfirmation('order-id');

    expect(add).toHaveBeenCalledWith(
      OrderQueue.Confirm,
      { orderId: 'order-id' },
      { jobId: 'order-confirmation-order-id' },
    );
  });

  it('does not fail an already-committed checkout when Redis is unavailable', async () => {
    add.mockRejectedValue(new Error('Redis unavailable'));

    await expect(
      service.enqueueConfirmation('order-id'),
    ).resolves.toBeUndefined();
  });

  it('records a queued outbox notification after publishing', async () => {
    findUnique.mockResolvedValue({ id: 'outbox-id' });
    add.mockResolvedValue({ id: 'job-id' });

    await service.enqueueConfirmation('order-id');

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-id', completedAt: null },
        data: expect.objectContaining({ attempts: { increment: 1 } }),
      }),
    );
  });
});
