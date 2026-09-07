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
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { ChatRealtimePublisher } from './chat-realtime.publisher.js';
import { ChatService } from './chat.service.js';
import type { ChatMessageView } from './chat.types.js';
import {
  ChatConversationSocketDto,
  SendChatSocketMessageDto,
} from './dto/chat-message.dto.js';

type AuthenticatedSocket = Socket & {
  data: { user?: AuthenticatedUser; accessToken?: string };
};

// Socket.IO performs its own CORS check for polling handshakes and websocket
// upgrades; Nest's HTTP CORS middleware does not cover the gateway. Keep the
// allow-list in sync with the API's CORS_ORIGINS environment variable so the
// storefront can establish a realtime connection from its separate origin.
const chatCorsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

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

@WebSocketGateway({
  namespace: '/chat',
  cors: chatCorsOrigins.length
    ? { origin: chatCorsOrigins, credentials: true }
    : false,
})
export class ChatGateway implements OnGatewayInit {
  constructor(
    private readonly accessTokens: AccessTokenVerifier,
    private readonly chat: ChatService,
    private readonly realtime: ChatRealtimePublisher,
    private readonly rateLimits: RateLimitService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.attach(server);
    server.use((socket, next) => {
      const client = socket as AuthenticatedSocket;
      void this.rateLimits
        .consume('chat:connection', this.clientAddress(socket), 30, 60_000)
        .then((result) => {
          if (!result.allowed) {
            next(new Error('Too many chat connection attempts'));
            return;
          }
          return this.authenticateSocket(client).then(
            () => next(),
            () => next(new Error('Unauthorized')),
          );
        })
        .catch(() => next(new Error('Chat is temporarily unavailable')));
    });
  }

  @SubscribeMessage('conversation:join')
  async joinConversation(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody(WS_VALIDATION_PIPE) input: ChatConversationSocketDto,
  ): Promise<{ conversationId: string }> {
    return this.handle(async () => {
      const actor = await this.actor(socket);
      await this.enforceUserRateLimit(actor.userId, 'chat:event', 120);
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
    return this.handle(async () => {
      const actor = await this.actor(socket);
      await this.enforceUserRateLimit(actor.userId, 'chat:event', 120);
      await socket.leave(this.realtime.roomName(input.conversationId));
      return { conversationId: input.conversationId };
    });
  }

  @SubscribeMessage('message:send')
  sendMessage(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody(WS_VALIDATION_PIPE) input: SendChatSocketMessageDto,
  ): Promise<ChatMessageView> {
    return this.handle(async () => {
      const actor = await this.actor(socket);
      await this.enforceUserRateLimit(actor.userId, 'chat:event', 120);
      await this.enforceUserRateLimit(actor.userId, 'chat:message', 60);
      return this.chat.sendMessage(actor, input.conversationId, input);
    });
  }

  private async enforceUserRateLimit(
    userId: string,
    namespace: string,
    limit: number,
  ): Promise<void> {
    const result = await this.rateLimits.consume(
      namespace,
      userId,
      limit,
      60_000,
    );
    if (!result.allowed) {
      throw new WsException({
        code: 'RATE_LIMITED',
        message: 'Too many chat requests. Please try again later.',
      });
    }
  }

  private async authenticateSocket(socket: AuthenticatedSocket): Promise<void> {
    const token = this.extractToken(socket);
    const actor = token ? await this.accessTokens.authenticate(token) : null;
    if (!actor) throw new Error('Unauthorized');
    socket.data.accessToken = token ?? undefined;
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

  private async actor(socket: AuthenticatedSocket): Promise<AuthenticatedUser> {
    const token = socket.data.accessToken;
    const actor = token ? await this.accessTokens.authenticate(token) : null;
    if (!actor) {
      socket.disconnect(true);
      throw new WsException('Unauthorized');
    }
    socket.data.user = actor;
    return actor;
  }

  private clientAddress(socket: Socket): string {
    return socket.handshake.address || 'unknown';
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
