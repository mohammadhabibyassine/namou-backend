import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ChatService } from './chat.service.js';
import type {
  ChatConversationPage,
  ChatConversationView,
  ChatMessagePage,
  ChatMessageView,
} from './chat.types.js';
import {
  CreateChatConversationDto,
  ListChatConversationsQueryDto,
} from './dto/chat-conversation.dto.js';
import {
  ListChatMessagesQueryDto,
  SendChatMessageDto,
} from './dto/chat-message.dto.js';

const UUID_V4_PIPE = new ParseUUIDPipe({ version: '4' });

@Controller('chat/conversations')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  findConversations(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListChatConversationsQueryDto,
  ): Promise<ChatConversationPage> {
    return this.chat.findOwnConversations(user.userId, query);
  }

  @Post()
  createConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateChatConversationDto,
  ): Promise<ChatConversationView> {
    return this.chat.createConversation(user.userId, input);
  }

  @Get(':conversationId/messages')
  findMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', UUID_V4_PIPE) conversationId: string,
    @Query() query: ListChatMessagesQueryDto,
  ): Promise<ChatMessagePage> {
    return this.chat.findMessages(user, conversationId, query);
  }

  @Post(':conversationId/messages')
  sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', UUID_V4_PIPE) conversationId: string,
    @Body() input: SendChatMessageDto,
  ): Promise<ChatMessageView> {
    return this.chat.sendMessage(user, conversationId, input);
  }

  @Patch(':conversationId/read')
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', UUID_V4_PIPE) conversationId: string,
  ): Promise<{ updatedCount: number }> {
    return this.chat.markRead(user, conversationId);
  }

  @Patch(':conversationId/close')
  closeConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', UUID_V4_PIPE) conversationId: string,
  ): Promise<ChatConversationView> {
    return this.chat.closeOwnConversation(user.userId, conversationId);
  }
}
