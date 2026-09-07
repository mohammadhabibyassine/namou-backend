import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import type { PrismaService } from '../prisma/prisma.service.js';
import { OrderConfirmationProcessor } from './order-confirmation.processor.js';
import { OrderQueue } from './order-jobs.constants.js';

describe('OrderConfirmationProcessor', () => {
  const loggerLog = vi
    .spyOn(Logger.prototype, 'log')
    .mockImplementation(() => undefined);
  const findUnique = vi.fn();
  const updateMany = vi.fn();
  const prisma = {
    order: { findUnique },
    orderNotificationOutbox: { updateMany },
  } as unknown as PrismaService;
  const processor = new OrderConfirmationProcessor(prisma);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => loggerLog.mockRestore());

  it('loads the committed order snapshot at the provider boundary', async () => {
    findUnique.mockResolvedValue({
      id: 'order-id',
      orderNumber: 'ORD-TEST',
      user: { email: 'customer@example.com' },
    });
    updateMany.mockResolvedValue({ count: 1 });

    await expect(
      processor.process({
        name: OrderQueue.Confirm,
        data: { orderId: 'order-id' },
      } as Job<{ orderId: string }, void, string>),
    ).resolves.toBeUndefined();
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order-id' } }),
    );
  });

  it('marks unknown job names as non-retryable programming errors', async () => {
    await expect(
      processor.process({
        name: 'unknown',
        data: { orderId: 'order-id' },
      } as Job<{ orderId: string }, void, string>),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
