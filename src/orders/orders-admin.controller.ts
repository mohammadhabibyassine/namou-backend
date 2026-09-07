import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { Permission } from '../auth/authorization/permission.constants.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import type { CursorPage } from '../common/pagination/cursor-page.js';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto.js';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto.js';
import { OrdersService } from './orders.service.js';
import type { OrderDetailView, OrderSummaryView } from './orders.types.js';

const UUID_V4_PIPE = new ParseUUIDPipe({ version: '4' });

@Controller('admin/orders')
@RequirePermissions(Permission.ManageOrders)
export class OrdersAdminController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findPage(
    @Query() query: ListOrdersQueryDto,
  ): Promise<CursorPage<OrderSummaryView>> {
    return this.ordersService.findAdminPage(query);
  }

  @Get(':orderId')
  findOrder(
    @Param('orderId', UUID_V4_PIPE) orderId: string,
  ): Promise<OrderDetailView> {
    return this.ordersService.findAdminOrder(orderId);
  }

  @Patch(':orderId/status')
  updateStatus(
    @Param('orderId', UUID_V4_PIPE) orderId: string,
    @Body() input: UpdateOrderStatusDto,
  ): Promise<OrderDetailView> {
    return this.ordersService.updateStatus(orderId, input.status);
  }
}
