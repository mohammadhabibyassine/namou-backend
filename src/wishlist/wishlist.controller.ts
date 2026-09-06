import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import {
  AddWishlistItemDto,
  MergeWishlistDto,
} from './dto/wishlist-item.dto.js';
import { ListWishlistQueryDto } from './dto/list-wishlist-query.dto.js';
import type { WishlistView } from './wishlist.types.js';
import { WishlistService } from './wishlist.service.js';

const UUID_V4_PIPE = new ParseUUIDPipe({ version: '4' });

@Controller('wishlist')
export class WishlistController {
  constructor(private readonly wishlistService: WishlistService) {}

  @Get()
  findWishlist(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListWishlistQueryDto,
  ): Promise<WishlistView> {
    return this.wishlistService.findWishlist(user.userId, query);
  }

  @Post()
  addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: AddWishlistItemDto,
  ): Promise<WishlistView> {
    return this.wishlistService.addItem(user.userId, input);
  }

  @Delete(':wishlistItemId')
  removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('wishlistItemId', UUID_V4_PIPE) wishlistItemId: string,
  ): Promise<WishlistView> {
    return this.wishlistService.removeItem(user.userId, wishlistItemId);
  }

  @Post('merge')
  merge(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: MergeWishlistDto,
  ): Promise<WishlistView> {
    return this.wishlistService.merge(user.userId, input);
  }
}
