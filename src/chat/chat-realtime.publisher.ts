import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { ChatMessageView } from './chat.types.js';

@Injectable()
export class ChatRealtimePublisher {
  private server?: Server;

  attach(server: Server): void {
    this.server = server;
  }

  publishMessage(message: ChatMessageView): void {
    this.server
      ?.to(this.roomName(message.conversationId))
      .emit('message:created', message);
  }

  roomName(conversationId: string): string {
    return `conversation:${conversationId}`;
  }
}
