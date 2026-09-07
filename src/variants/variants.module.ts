import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { AttributesController } from './attributes.controller.js';
import { AttributesService } from './attributes.service.js';
import { VariantsController } from './variants.controller.js';
import { VariantsService } from './variants.service.js';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [AttributesController, VariantsController],
  providers: [AttributesService, VariantsService],
  exports: [AttributesService, VariantsService],
})
export class VariantsModule {}
