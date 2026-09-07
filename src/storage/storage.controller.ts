import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Permission } from '../auth/authorization/permission.constants.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { CreatePresignedUrlDto } from './dto/create-presigned-url.dto.js';
import { DeleteProductUploadsDto } from './dto/delete-product-uploads.dto.js';
import { StorageService } from './storage.service.js';
import type { PresignedProductUploadResult } from './storage.types.js';

const UUID_V4_PIPE = new ParseUUIDPipe({ version: '4' });

@Controller('uploads/products/:productId')
@RequirePermissions(Permission.ManageProducts)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  /**
   * Generates a presigned PUT URL for direct-to-R2 file uploads.
   * The client should PUT the file bytes to the returned `uploadUrl`.
   */
  @Post('presigned-url')
  createPresignedUrl(
    @Param('productId', UUID_V4_PIPE) productId: string,
    @Body() dto: CreatePresignedUrlDto,
  ): Promise<PresignedProductUploadResult> {
    return this.storageService.createProductUploadUrl({
      productId,
      contentType: dto.contentType,
      fileSizeBytes: dto.fileSizeBytes,
    });
  }

  /** Deletes uploaded objects only when they have not been attached to a product. */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUnattachedUploads(
    @Param('productId', UUID_V4_PIPE) productId: string,
    @Body() dto: DeleteProductUploadsDto,
  ): Promise<void> {
    await this.storageService.deleteUnattachedProductObjects(
      productId,
      dto.objectKeys,
    );
  }
}
