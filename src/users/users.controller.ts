import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import type { UserAddressRecord, UserProfile } from './users.select.js';
import { UsersService } from './users.service.js';

const UUID_V4_PIPE = new ParseUUIDPipe({ version: '4' });

@Controller('users/me')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findProfile(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserProfile | null> {
    return this.usersService.findActiveProfileById(user.userId);
  }

  @Patch()
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: UpdateProfileDto,
  ): Promise<UserProfile> {
    return this.usersService.updateProfile(user.userId, input);
  }

  @Get('addresses')
  findAddresses(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserAddressRecord[]> {
    return this.usersService.findAddresses(user.userId);
  }

  @Post('addresses')
  createAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateAddressDto,
  ): Promise<UserAddressRecord> {
    return this.usersService.createAddress(user.userId, input);
  }

  @Patch('addresses/:addressId')
  updateAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('addressId', UUID_V4_PIPE) addressId: string,
    @Body() input: UpdateAddressDto,
  ): Promise<UserAddressRecord> {
    return this.usersService.updateAddress(user.userId, addressId, input);
  }

  @Delete('addresses/:addressId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('addressId', UUID_V4_PIPE) addressId: string,
  ): Promise<void> {
    return this.usersService.deleteAddress(user.userId, addressId);
  }
}
