import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ChatAdminController } from './chat-admin.controller.js';
import { ChatRealtimePublisher } from './chat-realtime.publisher.js';
import { ChatController } from './chat.controller.js';
import { ChatGateway } from './chat.gateway.js';
import { ChatService } from './chat.service.js';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ChatController, ChatAdminController],
  providers: [ChatService, ChatRealtimePublisher, ChatGateway],
})
export class ChatModule {}
