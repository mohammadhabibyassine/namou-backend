import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ProductsController } from './products.controller.js';
import { ProductsAdminService } from './products-admin.service.js';
import { ProductsRepository } from './products.repository.js';
import { ProductsService } from './products.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [ProductsController],
  providers: [ProductsRepository, ProductsService, ProductsAdminService],
  exports: [ProductsService, ProductsAdminService],
})
export class ProductsModule {}
