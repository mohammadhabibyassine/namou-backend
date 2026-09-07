import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { ProductsModule } from './products/products.module.js';
import { VariantsModule } from './variants/variants.module.js';
import { CartModule } from './cart/cart.module.js';
import { WishlistModule } from './wishlist/wishlist.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { ChatModule } from './chat/chat.module.js';
import { validateEnvironment } from './config/env.validation.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { authConfig } from './config/auth.config.js';
import { redisConfig } from './config/redis.config.js';
import { storageConfig } from './config/storage.config.js';
import { ApplicationCacheModule } from './cache/application-cache.module.js';
import { StorageModule } from './storage/storage.module.js';
import { RateLimitModule } from './rate-limit/rate-limit.module.js';
import { ordersConfig } from './config/orders.config.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [authConfig, redisConfig, storageConfig, ordersConfig],
      validate: validateEnvironment,
    }),
    PrismaModule,
    ApplicationCacheModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    ProductsModule,
    VariantsModule,
    CartModule,
    WishlistModule,
    OrdersModule,
    ChatModule,
    StorageModule,
    RateLimitModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
