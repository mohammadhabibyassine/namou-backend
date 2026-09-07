import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { CartService } from './cart.service.js';
import {
  AddCartItemDto,
  MergeCartDto,
  SetCartItemQuantityDto,
} from './dto/cart-item.dto.js';
import type { CartView } from './cart.types.js';

const UUID_V4_PIPE = new ParseUUIDPipe({ version: '4' });

@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  findCart(@CurrentUser() user: AuthenticatedUser): Promise<CartView> {
    return this.cartService.findCart(user.userId);
  }

  @Post('items')
  addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: AddCartItemDto,
  ): Promise<CartView> {
    return this.cartService.addItem(user.userId, input);
  }

  @Patch('items/:variantId')
  setQuantity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('variantId', UUID_V4_PIPE) variantId: string,
    @Body() input: SetCartItemQuantityDto,
  ): Promise<CartView> {
    return this.cartService.setQuantity(user.userId, variantId, input);
  }

  @Delete('items/:variantId')
  removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('variantId', UUID_V4_PIPE) variantId: string,
  ): Promise<CartView> {
    return this.cartService.removeItem(user.userId, variantId);
  }

  @Post('merge')
  merge(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: MergeCartDto,
  ): Promise<CartView> {
    return this.cartService.merge(user.userId, input);
  }
}
