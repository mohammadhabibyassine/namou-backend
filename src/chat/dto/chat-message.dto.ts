import { Transform } from 'class-transformer';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { CursorPaginationQueryDto } from '../../common/pagination/cursor-pagination-query.dto.js';

export const MAX_CHAT_MESSAGE_LENGTH = 5_000;

export class SendChatMessageDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_CHAT_MESSAGE_LENGTH)
  content: string;
}

export class SendChatSocketMessageDto extends SendChatMessageDto {
  @IsUUID('4')
  conversationId: string;
}

export class ChatConversationSocketDto {
  @IsUUID('4')
  conversationId: string;
}

export class ListChatMessagesQueryDto extends CursorPaginationQueryDto {}
