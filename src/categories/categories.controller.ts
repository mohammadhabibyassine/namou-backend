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
import { Permission } from '../auth/authorization/permission.constants.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { CategoriesService } from './categories.service.js';
import type { CategoryRecord } from './categories.select.js';
import type { CategoryTreeNode } from './categories.types.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';

const UUID_V4_PIPE = new ParseUUIDPipe({ version: '4' });

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get('tree')
  @Public()
  findTree(): Promise<CategoryTreeNode[]> {
    return this.categoriesService.findTree();
  }

  @Get(':id/subtree')
  @Public()
  findSubtree(
    @Param('id', UUID_V4_PIPE) categoryId: string,
  ): Promise<CategoryTreeNode> {
    return this.categoriesService.findSubtree(categoryId);
  }

  @Get(':id')
  @Public()
  findOne(
    @Param('id', UUID_V4_PIPE) categoryId: string,
  ): Promise<CategoryRecord> {
    return this.categoriesService.findOne(categoryId);
  }

  @Post()
  @RequirePermissions(Permission.ManageCategories)
  create(@Body() input: CreateCategoryDto): Promise<CategoryRecord> {
    return this.categoriesService.create(input);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ManageCategories)
  update(
    @Param('id', UUID_V4_PIPE) categoryId: string,
    @Body() input: UpdateCategoryDto,
  ): Promise<CategoryRecord> {
    return this.categoriesService.update(categoryId, input);
  }

  @Delete(':id')
  @RequirePermissions(Permission.ManageCategories)
  @HttpCode(HttpStatus.NO_CONTENT)
  softDelete(@Param('id', UUID_V4_PIPE) categoryId: string): Promise<void> {
    return this.categoriesService.softDelete(categoryId);
  }
}
