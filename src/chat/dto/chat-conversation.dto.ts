import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CursorPaginationQueryDto } from '../../common/pagination/cursor-pagination-query.dto.js';
import { ChatConversationStatus } from '../../generated/prisma/enums.js';

export class CreateChatConversationDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string;
}

export class ListChatConversationsQueryDto extends CursorPaginationQueryDto {
  @IsOptional()
  @IsEnum(ChatConversationStatus)
  status?: ChatConversationStatus;
}

export class UpdateChatConversationStatusDto {
  @IsEnum(ChatConversationStatus)
  status: ChatConversationStatus;
}
