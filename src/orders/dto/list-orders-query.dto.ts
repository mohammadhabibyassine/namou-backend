import { IsEnum, IsOptional } from 'class-validator';
import { CursorPaginationQueryDto } from '../../common/pagination/cursor-pagination-query.dto.js';
import { OrderStatus } from '../../generated/prisma/enums.js';

export class ListOrdersQueryDto extends CursorPaginationQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}
