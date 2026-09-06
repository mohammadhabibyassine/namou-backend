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
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { AttributesService } from './attributes.service.js';
import {
  CreateAttributeTypeDto,
  CreateAttributeValueDto,
  UpdateAttributeTypeDto,
  UpdateAttributeValueDto,
} from './dto/attribute-type.dto.js';
import type {
  AttributeTypeRecord,
  AttributeValueRecord,
} from './variants.select.js';

const UUID_V4_PIPE = new ParseUUIDPipe({ version: '4' });

@Controller('attribute-types')
@RequirePermissions(Permission.ManageProducts)
export class AttributesController {
  constructor(private readonly attributesService: AttributesService) {}

  @Get()
  findAll(): Promise<AttributeTypeRecord[]> {
    return this.attributesService.findAll();
  }

  @Post()
  createType(
    @Body() input: CreateAttributeTypeDto,
  ): Promise<AttributeTypeRecord> {
    return this.attributesService.createType(input);
  }

  @Patch(':attributeTypeId')
  updateType(
    @Param('attributeTypeId', UUID_V4_PIPE) attributeTypeId: string,
    @Body() input: UpdateAttributeTypeDto,
  ): Promise<AttributeTypeRecord> {
    return this.attributesService.updateType(attributeTypeId, input);
  }

  @Delete(':attributeTypeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteType(
    @Param('attributeTypeId', UUID_V4_PIPE) attributeTypeId: string,
  ): Promise<void> {
    return this.attributesService.deleteType(attributeTypeId);
  }

  @Post(':attributeTypeId/values')
  createValue(
    @Param('attributeTypeId', UUID_V4_PIPE) attributeTypeId: string,
    @Body() input: CreateAttributeValueDto,
  ): Promise<AttributeValueRecord> {
    return this.attributesService.createValue(attributeTypeId, input);
  }

  @Patch(':attributeTypeId/values/:attributeValueId')
  updateValue(
    @Param('attributeTypeId', UUID_V4_PIPE) attributeTypeId: string,
    @Param('attributeValueId', UUID_V4_PIPE) attributeValueId: string,
    @Body() input: UpdateAttributeValueDto,
  ): Promise<AttributeValueRecord> {
    return this.attributesService.updateValue(
      attributeTypeId,
      attributeValueId,
      input,
    );
  }

  @Delete(':attributeTypeId/values/:attributeValueId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteValue(
    @Param('attributeTypeId', UUID_V4_PIPE) attributeTypeId: string,
    @Param('attributeValueId', UUID_V4_PIPE) attributeValueId: string,
  ): Promise<void> {
    return this.attributesService.deleteValue(
      attributeTypeId,
      attributeValueId,
    );
  }
}
