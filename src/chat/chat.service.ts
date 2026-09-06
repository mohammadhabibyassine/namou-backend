import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { Permission } from '../auth/authorization/permission.constants.js';
import type { CursorPage } from '../common/pagination/cursor-page.js';
import {
  decodeIdCursor,
  encodeIdCursor,
} from '../common/pagination/opaque-id-cursor.js';
import { Prisma } from '../generated/prisma/client.js';
import { ChatConversationStatus } from '../generated/prisma/enums.js';
import {
  getPrismaDatabaseError,
  isPrismaKnownRequestError,
} from '../prisma/prisma-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChatRealtimePublisher } from './chat-realtime.publisher.js';
import {
  CHAT_CONVERSATION_SELECT,
  CHAT_MESSAGE_SELECT,
  type ChatConversationRecord,
  type ChatMessageRecord,
} from './chat.select.js';
import type {
  ChatConversationPage,
  ChatConversationView,
  ChatMessagePage,
  ChatMessageView,
} from './chat.types.js';
import type {
  CreateChatConversationDto,
  ListChatConversationsQueryDto,
} from './dto/chat-conversation.dto.js';
import type {
  ListChatMessagesQueryDto,
  SendChatMessageDto,
} from './dto/chat-message.dto.js';

const WRITE_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

interface LockedConversation {
  id: string;
  userId: string;
  assignedAdminId: string | null;
  status: ChatConversationStatus;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: ChatRealtimePublisher,
  ) {}

  async createConversation(
    userId: string,
    input: CreateChatConversationDto,
  ): Promise<ChatConversationView> {
    const conversation = await this.prisma.chatConversation.create({
      data: { userId, subject: input.subject ?? null },
      select: CHAT_CONVERSATION_SELECT,
    });
    return this.toConversationView(conversation);
  }

  findOwnConversations(
    userId: string,
    query: ListChatConversationsQueryDto,
  ): Promise<ChatConversationPage> {
    return this.findConversationPage(
      { userId },
      `chat-conversations:user:${userId}:status:${query.status ?? '*'}`,
      query,
    );
  }

  findAdminConversations(
    query: ListChatConversationsQueryDto,
  ): Promise<ChatConversationPage> {
    return this.findConversationPage(
      {},
      `chat-conversations:admin:status:${query.status ?? '*'}`,
      query,
    );
  }

  async findMessages(
    actor: AuthenticatedUser,
    conversationId: string,
    query: ListChatMessagesQueryDto,
  ): Promise<ChatMessagePage> {
    await this.assertReadAccess(actor, conversationId);
    const context = `chat-messages:actor:${actor.userId}:conversation:${conversationId}`;
    const cursorId = query.cursor
      ? decodeIdCursor(query.cursor, context)
      : undefined;
    const records = await this.prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: cursorId ? { id: cursorId } : undefined,
      skip: cursorId ? 1 : 0,
      take: query.pageSize + 1,
      select: CHAT_MESSAGE_SELECT,
    });
    return this.messagePage(records, query.pageSize, context);
  }

  async sendMessage(
    actor: AuthenticatedUser,
    conversationId: string,
    input: SendChatMessageDto,
  ): Promise<ChatMessageView> {
    try {
      const record = await this.prisma.$transaction(async (tx) => {
        const conversation = await this.lockConversation(tx, conversationId);
        this.assertCanSend(actor, conversation);
        return tx.chatMessage.create({
          data: {
            conversationId,
            senderId: actor.userId,
            content: input.content.trim(),
          },
          select: CHAT_MESSAGE_SELECT,
        });
      }, WRITE_TRANSACTION_OPTIONS);
      const message = this.toMessageView(record);
      this.realtime.publishMessage(message);
      return message;
    } catch (error: unknown) {
      this.rethrowWriteError(error);
    }
  }

  async assignToSelf(
    admin: AuthenticatedUser,
    conversationId: string,
  ): Promise<ChatConversationView> {
    this.assertManageChat(admin);
    try {
      const record = await this.prisma.$transaction(async (tx) => {
        const current = await this.lockConversation(tx, conversationId);
        if (current.status !== ChatConversationStatus.open) {
          throw new ConflictException(
            'Only open conversations can be assigned',
          );
        }
        if (
          current.assignedAdminId &&
          current.assignedAdminId !== admin.userId
        ) {
          throw new ConflictException(
            'Conversation is already assigned to another support user',
          );
        }
        return tx.chatConversation.update({
          where: { id: conversationId },
          data: { assignedAdminId: admin.userId },
          select: CHAT_CONVERSATION_SELECT,
        });
      }, WRITE_TRANSACTION_OPTIONS);
      return this.toConversationView(record);
    } catch (error: unknown) {
      this.rethrowWriteError(error);
    }
  }

  async closeOwnConversation(
    userId: string,
    conversationId: string,
  ): Promise<ChatConversationView> {
    const record = await this.prisma.chatConversation
      .update({
        where: {
          id: conversationId,
          userId,
          status: ChatConversationStatus.open,
        },
        data: { status: ChatConversationStatus.closed },
        select: CHAT_CONVERSATION_SELECT,
      })
      .catch((error: unknown) => {
        if (isPrismaKnownRequestError(error, 'P2025')) {
          throw new NotFoundException('Open conversation not found');
        }
        throw error;
      });
    return this.toConversationView(record);
  }

  async updateStatus(
    admin: AuthenticatedUser,
    conversationId: string,
    nextStatus: ChatConversationStatus,
  ): Promise<ChatConversationView> {
    this.assertManageChat(admin);
    const allowed: Record<
      ChatConversationStatus,
      readonly ChatConversationStatus[]
    > = {
      open: [ChatConversationStatus.closed, ChatConversationStatus.archived],
      closed: [ChatConversationStatus.open, ChatConversationStatus.archived],
      archived: [],
    };
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockConversation(tx, conversationId);
      if (!allowed[current.status].includes(nextStatus)) {
        throw new ConflictException(
          `Conversation cannot transition from ${current.status} to ${nextStatus}`,
        );
      }
      const updated = await tx.chatConversation.update({
        where: { id: conversationId },
        data: { status: nextStatus },
        select: CHAT_CONVERSATION_SELECT,
      });
      return this.toConversationView(updated);
    }, WRITE_TRANSACTION_OPTIONS);
  }

  async markRead(
    actor: AuthenticatedUser,
    conversationId: string,
  ): Promise<{ updatedCount: number }> {
    await this.assertReadAccess(actor, conversationId);
    const result = await this.prisma.chatMessage.updateMany({
      where: {
        conversationId,
        senderId: { not: actor.userId },
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    return { updatedCount: result.count };
  }

  async assertReadAccess(
    actor: AuthenticatedUser,
    conversationId: string,
  ): Promise<void> {
    const conversation = await this.prisma.chatConversation.findFirst({
      where: {
        id: conversationId,
        ...(this.canManageChat(actor) ? {} : { userId: actor.userId }),
      },
      select: { id: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
  }

  private async findConversationPage(
    scope: { userId?: string },
    context: string,
    query: ListChatConversationsQueryDto,
  ): Promise<ChatConversationPage> {
    const cursorId = query.cursor
      ? decodeIdCursor(query.cursor, context)
      : undefined;
    const records = await this.prisma.chatConversation.findMany({
      where: { ...scope, status: query.status },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      cursor: cursorId ? { id: cursorId } : undefined,
      skip: cursorId ? 1 : 0,
      take: query.pageSize + 1,
      select: CHAT_CONVERSATION_SELECT,
    });
    const hasNextPage = records.length > query.pageSize;
    const pageRecords = records.slice(0, query.pageSize);
    const last = pageRecords.at(-1);
    return {
      items: pageRecords.map((record) => this.toConversationView(record)),
      pageInfo: {
        hasNextPage,
        endCursor: last ? encodeIdCursor(last.id, context) : null,
      },
    };
  }

  private messagePage(
    records: ChatMessageRecord[],
    pageSize: number,
    context: string,
  ): CursorPage<ChatMessageView> {
    const hasNextPage = records.length > pageSize;
    const pageRecords = records.slice(0, pageSize);
    const last = pageRecords.at(-1);
    return {
      items: pageRecords.map((record) => this.toMessageView(record)),
      pageInfo: {
        hasNextPage,
        endCursor: last ? encodeIdCursor(last.id, context) : null,
      },
    };
  }

  private async lockConversation(
    tx: Prisma.TransactionClient,
    conversationId: string,
  ): Promise<LockedConversation> {
    const rows = await tx.$queryRaw<LockedConversation[]>(Prisma.sql`
      SELECT
        id,
        user_id AS "userId",
        assigned_admin_id AS "assignedAdminId",
        status::text AS status
      FROM chat_conversations
      WHERE id = ${conversationId}::uuid
      FOR UPDATE
    `);
    if (!rows[0]) throw new NotFoundException('Conversation not found');
    return rows[0];
  }

  private assertCanSend(
    actor: AuthenticatedUser,
    conversation: LockedConversation,
  ): void {
    if (conversation.status !== ChatConversationStatus.open) {
      throw new ConflictException('Conversation is not open');
    }
    if (conversation.userId === actor.userId) return;
    if (
      this.canManageChat(actor) &&
      conversation.assignedAdminId === actor.userId
    ) {
      return;
    }
    throw new ForbiddenException(
      'Support users must claim a conversation before replying',
    );
  }

  private assertManageChat(actor: AuthenticatedUser): void {
    if (!this.canManageChat(actor)) {
      throw new ForbiddenException('manage_chat permission is required');
    }
  }

  private canManageChat(actor: AuthenticatedUser): boolean {
    return actor.permissions.includes(Permission.ManageChat);
  }

  private toConversationView(
    record: ChatConversationRecord,
  ): ChatConversationView {
    return record;
  }

  private toMessageView(record: ChatMessageRecord): ChatMessageView {
    const { sender, ...message } = record;
    return {
      ...message,
      sender: { ...sender, role: sender.role.name },
    };
  }

  private rethrowWriteError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (isPrismaKnownRequestError(error, 'P2025')) {
      throw new NotFoundException('Conversation not found');
    }
    if (isPrismaKnownRequestError(error, 'P2034')) {
      throw new ConflictException('Concurrent chat update; please retry');
    }
    if (getPrismaDatabaseError(error)?.code === 'P0001') {
      throw new ConflictException('Chat participants or assignment changed');
    }
    throw error;
  }
}
