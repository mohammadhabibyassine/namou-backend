import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApplicationCacheService } from '../cache/application-cache.service.js';
import { CacheNamespace } from '../cache/cache.constants.js';
import { normalizeSlug } from '../common/normalizers/slug.normalizer.js';
import {
  getPrismaDatabaseError,
  isPrismaKnownRequestError,
} from '../prisma/prisma-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateAttributeTypeDto,
  CreateAttributeValueDto,
  UpdateAttributeTypeDto,
  UpdateAttributeValueDto,
} from './dto/attribute-type.dto.js';
import {
  ATTRIBUTE_TYPE_SELECT,
  ATTRIBUTE_VALUE_SELECT,
  type AttributeTypeRecord,
  type AttributeValueRecord,
} from './variants.select.js';

@Injectable()
export class AttributesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ApplicationCacheService,
  ) {}

  findAll(): Promise<AttributeTypeRecord[]> {
    return this.prisma.attributeType.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      select: ATTRIBUTE_TYPE_SELECT,
    });
  }

  async createType(
    input: CreateAttributeTypeDto,
  ): Promise<AttributeTypeRecord> {
    try {
      const type = await this.prisma.attributeType.create({
        data: {
          name: input.name.trim(),
          slug: normalizeSlug(input.slug),
          sortOrder: input.sortOrder,
        },
        select: ATTRIBUTE_TYPE_SELECT,
      });
      await this.invalidateCatalog();
      return type;
    } catch (error: unknown) {
      this.rethrowTypeWriteError(error);
    }
  }

  async updateType(
    attributeTypeId: string,
    input: UpdateAttributeTypeDto,
  ): Promise<AttributeTypeRecord> {
    if (
      input.name === undefined &&
      input.slug === undefined &&
      input.sortOrder === undefined
    ) {
      throw new BadRequestException(
        'At least one attribute type field is required',
      );
    }

    try {
      const type = await this.prisma.attributeType.update({
        where: { id: attributeTypeId },
        data: {
          name: input.name?.trim(),
          slug:
            input.slug === undefined ? undefined : normalizeSlug(input.slug),
          sortOrder: input.sortOrder,
        },
        select: ATTRIBUTE_TYPE_SELECT,
      });
      await this.invalidateCatalog();
      return type;
    } catch (error: unknown) {
      this.rethrowTypeWriteError(error);
    }
  }

  async deleteType(attributeTypeId: string): Promise<void> {
    try {
      await this.prisma.attributeType.delete({
        where: { id: attributeTypeId },
        select: { id: true },
      });
      await this.invalidateCatalog();
    } catch (error: unknown) {
      if (isPrismaKnownRequestError(error, 'P2025')) {
        throw new NotFoundException('Attribute type not found');
      }
      if (this.isForeignKeyViolation(error)) {
        throw new ConflictException(
          'Attribute type must have no values or product references before deletion',
        );
      }
      throw error;
    }
  }

  async createValue(
    attributeTypeId: string,
    input: CreateAttributeValueDto,
  ): Promise<AttributeValueRecord> {
    try {
      const value = await this.prisma.attributeValue.create({
        data: {
          attributeType: { connect: { id: attributeTypeId } },
          value: input.value.trim(),
          sortOrder: input.sortOrder,
        },
        select: ATTRIBUTE_VALUE_SELECT,
      });
      await this.invalidateCatalog();
      return value;
    } catch (error: unknown) {
      this.rethrowValueWriteError(error);
    }
  }

  async updateValue(
    attributeTypeId: string,
    attributeValueId: string,
    input: UpdateAttributeValueDto,
  ): Promise<AttributeValueRecord> {
    if (input.value === undefined && input.sortOrder === undefined) {
      throw new BadRequestException(
        'At least one attribute value field is required',
      );
    }

    try {
      const value = await this.prisma.attributeValue.update({
        where: { id: attributeValueId, attributeTypeId },
        data: {
          value: input.value?.trim(),
          sortOrder: input.sortOrder,
        },
        select: ATTRIBUTE_VALUE_SELECT,
      });
      await this.invalidateCatalog();
      return value;
    } catch (error: unknown) {
      this.rethrowValueWriteError(error);
    }
  }

  async deleteValue(
    attributeTypeId: string,
    attributeValueId: string,
  ): Promise<void> {
    try {
      await this.prisma.attributeValue.delete({
        where: { id: attributeValueId, attributeTypeId },
        select: { id: true },
      });
      await this.invalidateCatalog();
    } catch (error: unknown) {
      if (isPrismaKnownRequestError(error, 'P2025')) {
        throw new NotFoundException('Attribute value not found');
      }
      if (this.isForeignKeyViolation(error)) {
        throw new ConflictException(
          'Attribute value is still used by one or more products',
        );
      }
      throw error;
    }
  }

  private rethrowTypeWriteError(error: unknown): never {
    if (isPrismaKnownRequestError(error, 'P2025')) {
      throw new NotFoundException('Attribute type not found');
    }
    if (
      isPrismaKnownRequestError(error, 'P2002') ||
      getPrismaDatabaseError(error)?.code === '23505'
    ) {
      throw new ConflictException(
        'Attribute type name or slug is already in use',
      );
    }
    throw error;
  }

  private rethrowValueWriteError(error: unknown): never {
    if (isPrismaKnownRequestError(error, 'P2025')) {
      throw new NotFoundException('Attribute type or value not found');
    }
    if (
      isPrismaKnownRequestError(error, 'P2002') ||
      getPrismaDatabaseError(error)?.code === '23505'
    ) {
      throw new ConflictException(
        'Attribute value is already defined for this attribute type',
      );
    }
    throw error;
  }

  private isForeignKeyViolation(error: unknown): boolean {
    return (
      isPrismaKnownRequestError(error, 'P2003') ||
      getPrismaDatabaseError(error)?.code === '23503'
    );
  }

  private invalidateCatalog(): Promise<void> {
    return this.cache.invalidate(CacheNamespace.ProductCatalog);
  }
}
