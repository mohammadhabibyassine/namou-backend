import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { Permission } from '../auth/authorization/permission.constants.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import type { CursorPage } from '../common/pagination/cursor-page.js';
import { CheckoutDto } from './dto/checkout.dto.js';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto.js';
import { OrdersService } from './orders.service.js';
import type { OrderDetailView, OrderSummaryView } from './orders.types.js';

const UUID_V4_PIPE = new ParseUUIDPipe({ version: '4' });

@Controller('orders')
@RequirePermissions(Permission.ViewOrders)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout')
  checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CheckoutDto,
  ): Promise<OrderDetailView> {
    return this.ordersService.checkout(user.userId, input);
  }

  @Get()
  findPage(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOrdersQueryDto,
  ): Promise<CursorPage<OrderSummaryView>> {
    return this.ordersService.findOwnPage(user.userId, query);
  }

  @Get(':orderId')
  findOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', UUID_V4_PIPE) orderId: string,
  ): Promise<OrderDetailView> {
    return this.ordersService.findOwnOrder(user.userId, orderId);
  }
}
