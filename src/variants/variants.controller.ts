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
  Put,
} from '@nestjs/common';
import { Permission } from '../auth/authorization/permission.constants.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { ReplaceProductImagesDto } from './dto/replace-product-images.dto.js';
import { ReplaceVariantConfigurationDto } from './dto/replace-variant-configuration.dto.js';
import { UpdateVariantDto } from './dto/update-variant.dto.js';
import type {
  AdminVariantView,
  ProductImageAdminView,
  VariantConfigurationView,
} from './variants.types.js';
import { VariantsService } from './variants.service.js';

const UUID_V4_PIPE = new ParseUUIDPipe({ version: '4' });

@Controller('products/:productId')
@RequirePermissions(Permission.ManageProducts)
export class VariantsController {
  constructor(private readonly variantsService: VariantsService) {}

  @Get('variant-configuration')
  findConfiguration(
    @Param('productId', UUID_V4_PIPE) productId: string,
  ): Promise<VariantConfigurationView> {
    return this.variantsService.findConfiguration(productId);
  }

  @Put('variant-configuration')
  replaceConfiguration(
    @Param('productId', UUID_V4_PIPE) productId: string,
    @Body() input: ReplaceVariantConfigurationDto,
  ): Promise<VariantConfigurationView> {
    return this.variantsService.replaceConfiguration(productId, input);
  }

  @Patch('variants/:variantId')
  updateVariant(
    @Param('productId', UUID_V4_PIPE) productId: string,
    @Param('variantId', UUID_V4_PIPE) variantId: string,
    @Body() input: UpdateVariantDto,
  ): Promise<AdminVariantView> {
    return this.variantsService.updateVariant(productId, variantId, input);
  }

  @Delete('variants/:variantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteVariant(
    @Param('productId', UUID_V4_PIPE) productId: string,
    @Param('variantId', UUID_V4_PIPE) variantId: string,
  ): Promise<void> {
    return this.variantsService.softDeleteVariant(productId, variantId);
  }

  @Put('images')
  replaceImages(
    @Param('productId', UUID_V4_PIPE) productId: string,
    @Body() input: ReplaceProductImagesDto,
  ): Promise<ProductImageAdminView[]> {
    return this.variantsService.replaceImages(productId, input);
  }

  @Get('images')
  findImages(
    @Param('productId', UUID_V4_PIPE) productId: string,
  ): Promise<ProductImageAdminView[]> {
    return this.variantsService.findImages(productId);
  }
}
