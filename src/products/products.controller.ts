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
  Query,
} from '@nestjs/common';
import { Permission } from '../auth/authorization/permission.constants.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import type { CursorPage } from '../common/pagination/cursor-page.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { ListProductsQueryDto } from './dto/list-products-query.dto.js';
import { ProductSlugParamsDto } from './dto/product-slug-params.dto.js';
import { ProductFacetsQueryDto } from './dto/product-facets-query.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { ProductsAdminService } from './products-admin.service.js';
import { ProductsService } from './products.service.js';
import type {
  ProductAdminView,
  ProductCatalogFacets,
  ProductCreatedResult,
  ProductDetail,
  ProductListItem,
} from './products.types.js';

const UUID_V4_PIPE = new ParseUUIDPipe({ version: '4' });

@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly productsAdminService: ProductsAdminService,
  ) {}

  @Post()
  @RequirePermissions(Permission.ManageProducts)
  create(@Body() input: CreateProductDto): Promise<ProductCreatedResult> {
    return this.productsAdminService.create(input);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ManageProducts)
  update(
    @Param('id', UUID_V4_PIPE) productId: string,
    @Body() input: UpdateProductDto,
  ): Promise<ProductAdminView> {
    return this.productsAdminService.update(productId, input);
  }

  @Delete(':id')
  @RequirePermissions(Permission.ManageProducts)
  @HttpCode(HttpStatus.NO_CONTENT)
  softDelete(@Param('id', UUID_V4_PIPE) productId: string): Promise<void> {
    return this.productsAdminService.softDelete(productId);
  }

  @Get()
  @Public()
  findCatalogPage(
    @Query() query: ListProductsQueryDto,
  ): Promise<CursorPage<ProductListItem>> {
    return this.productsService.findCatalogPage(query);
  }

  @Get('facets')
  @Public()
  findCatalogFacets(
    @Query() query: ProductFacetsQueryDto,
  ): Promise<ProductCatalogFacets> {
    return this.productsService.findCatalogFacets(query);
  }

  @Get(':slug')
  @Public()
  findBySlug(@Param() params: ProductSlugParamsDto): Promise<ProductDetail> {
    return this.productsService.findBySlug(params.slug);
  }
}
