import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService) {
    const adapter = new PrismaPg({
      connectionString: configService.getOrThrow<string>('DATABASE_URL'),
      // Prisma's pg adapter currently misinterprets TIMESTAMPTZ values when a
      // PostgreSQL session uses a non-UTC timezone. Pin every pooled session to
      // UTC until the upstream adapter issue is resolved.
      options: '-c timezone=UTC',
      application_name: 'namou',
    });

    super({
      adapter,
      omit: {
        user: {
          passwordHash: true,
        },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
