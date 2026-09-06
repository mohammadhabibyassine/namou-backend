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
import { Permission } from '../auth/authorization/permission.constants.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { ChatService } from './chat.service.js';
import type {
  ChatConversationPage,
  ChatConversationView,
  ChatMessagePage,
  ChatMessageView,
} from './chat.types.js';
import {
  ListChatConversationsQueryDto,
  UpdateChatConversationStatusDto,
} from './dto/chat-conversation.dto.js';
import {
  ListChatMessagesQueryDto,
  SendChatMessageDto,
} from './dto/chat-message.dto.js';

const UUID_V4_PIPE = new ParseUUIDPipe({ version: '4' });

@Controller('admin/chat/conversations')
@RequirePermissions(Permission.ManageChat)
export class ChatAdminController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  findConversations(
    @Query() query: ListChatConversationsQueryDto,
  ): Promise<ChatConversationPage> {
    return this.chat.findAdminConversations(query);
  }

  @Get(':conversationId/messages')
  findMessages(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('conversationId', UUID_V4_PIPE) conversationId: string,
    @Query() query: ListChatMessagesQueryDto,
  ): Promise<ChatMessagePage> {
    return this.chat.findMessages(admin, conversationId, query);
  }

  @Patch(':conversationId/assignment')
  assignToSelf(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('conversationId', UUID_V4_PIPE) conversationId: string,
  ): Promise<ChatConversationView> {
    return this.chat.assignToSelf(admin, conversationId);
  }

  @Post(':conversationId/messages')
  sendMessage(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('conversationId', UUID_V4_PIPE) conversationId: string,
    @Body() input: SendChatMessageDto,
  ): Promise<ChatMessageView> {
    return this.chat.sendMessage(admin, conversationId, input);
  }

  @Patch(':conversationId/read')
  markRead(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('conversationId', UUID_V4_PIPE) conversationId: string,
  ): Promise<{ updatedCount: number }> {
    return this.chat.markRead(admin, conversationId);
  }

  @Patch(':conversationId/status')
  updateStatus(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('conversationId', UUID_V4_PIPE) conversationId: string,
    @Body() input: UpdateChatConversationStatusDto,
  ): Promise<ChatConversationView> {
    return this.chat.updateStatus(admin, conversationId, input.status);
  }
}
