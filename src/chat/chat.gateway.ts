import {
  type OnGatewayInit,
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WsException,
} from '@nestjs/websockets';
import { type HttpException, ValidationPipe } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AccessTokenVerifier } from '../auth/jwt/access-token-verifier.js';
import { ChatRealtimePublisher } from './chat-realtime.publisher.js';
import { ChatService } from './chat.service.js';
import type { ChatMessageView } from './chat.types.js';
import {
  ChatConversationSocketDto,
  SendChatSocketMessageDto,
} from './dto/chat-message.dto.js';

type AuthenticatedSocket = Socket & {
  data: { user?: AuthenticatedUser };
};

const WS_VALIDATION_PIPE = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  validationError: { target: false, value: false },
  exceptionFactory: (errors) =>
    new WsException({
      code: 'VALIDATION_ERROR',
      message: errors
        .flatMap((error) => Object.values(error.constraints ?? {}))
        .join('; '),
    }),
});

@WebSocketGateway({ namespace: '/chat' })
export class ChatGateway implements OnGatewayInit {
  constructor(
    private readonly accessTokens: AccessTokenVerifier,
    private readonly chat: ChatService,
    private readonly realtime: ChatRealtimePublisher,
  ) {}

  afterInit(server: Server): void {
    this.realtime.attach(server);
    server.use((socket, next) => {
      void this.authenticateSocket(socket as AuthenticatedSocket).then(
        () => next(),
        () => next(new Error('Unauthorized')),
      );
    });
  }

  @SubscribeMessage('conversation:join')
  async joinConversation(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody(WS_VALIDATION_PIPE) input: ChatConversationSocketDto,
  ): Promise<{ conversationId: string }> {
    return this.handle(async () => {
      const actor = this.actor(socket);
      await this.chat.assertReadAccess(actor, input.conversationId);
      await socket.join(this.realtime.roomName(input.conversationId));
      return { conversationId: input.conversationId };
    });
  }

  @SubscribeMessage('conversation:leave')
  async leaveConversation(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody(WS_VALIDATION_PIPE) input: ChatConversationSocketDto,
  ): Promise<{ conversationId: string }> {
    await socket.leave(this.realtime.roomName(input.conversationId));
    return { conversationId: input.conversationId };
  }

  @SubscribeMessage('message:send')
  sendMessage(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody(WS_VALIDATION_PIPE) input: SendChatSocketMessageDto,
  ): Promise<ChatMessageView> {
    return this.handle(() =>
      this.chat.sendMessage(this.actor(socket), input.conversationId, input),
    );
  }

  private async authenticateSocket(socket: AuthenticatedSocket): Promise<void> {
    const token = this.extractToken(socket);
    const actor = token ? await this.accessTokens.authenticate(token) : null;
    if (!actor) throw new Error('Unauthorized');
    socket.data.user = actor;
  }

  private extractToken(socket: Socket): string | null {
    const authToken: unknown = socket.handshake.auth.token;
    if (typeof authToken === 'string' && authToken) return authToken;

    const authorization = socket.handshake.headers.authorization;
    if (typeof authorization !== 'string') return null;
    const [scheme, token] = authorization.split(' ');
    return scheme?.toLowerCase() === 'bearer' && token ? token : null;
  }

  private actor(socket: AuthenticatedSocket): AuthenticatedUser {
    const actor = socket.data.user;
    if (!actor) throw new WsException('Unauthorized');
    return actor;
  }

  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof WsException) throw error;
      const httpError = error as Partial<HttpException>;
      const status =
        typeof httpError.getStatus === 'function'
          ? httpError.getStatus()
          : undefined;
      throw new WsException({
        code: status ?? 'CHAT_ERROR',
        message:
          status === 401
            ? 'Unauthorized'
            : status === 403
              ? 'Forbidden'
              : 'Chat request failed',
      });
    }
  }
}
