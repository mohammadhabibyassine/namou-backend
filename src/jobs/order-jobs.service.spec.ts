import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { OrderQueue } from './order-jobs.constants.js';
import { OrderJobsService } from './order-jobs.service.js';

describe('OrderJobsService', () => {
  const loggerError = vi
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
  const add = vi.fn();
  const queue = { add } as unknown as Queue;
  const service = new OrderJobsService(queue);

  beforeEach(() => {
    vi.clearAllMocks();
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
});
