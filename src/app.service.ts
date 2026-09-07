import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from './generated/prisma/client.js';
import { PrismaService } from './prisma/prisma.service.js';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  getHello(): string {
    return 'Hello World!';
  }

  getLiveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  async getReadiness(): Promise<{ status: 'ready' }> {
    try {
      await this.prisma.$queryRaw(Prisma.sql`SELECT 1`);
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('Database is not ready');
    }
  }
}
