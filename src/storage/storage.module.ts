import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { StorageController } from './storage.controller.js';
import { StorageService } from './storage.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [StorageController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
