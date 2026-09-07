import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normalizeSlug } from '../common/normalizers/slug.normalizer.js';
import { ApplicationCacheService } from '../cache/application-cache.service.js';
import {
  CacheNamespace,
  CATALOG_CACHE_TTL_MILLISECONDS,
} from '../cache/cache.constants.js';
import {
  getPrismaDatabaseError,
  isPrismaKnownRequestError,
} from '../prisma/prisma-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CATEGORY_SELECT, type CategoryRecord } from './categories.select.js';
import type { CategoryTreeNode, CategoryTreeRow } from './categories.types.js';
import type { CreateCategoryDto } from './dto/create-category.dto.js';
import type { UpdateCategoryDto } from './dto/update-category.dto.js';

const CATEGORY_TRIGGER_ERROR_CODE = 'P0001';
const CATEGORY_PARENT_ERRORS = [
  'A category cannot be its own parent',
  'Parent category',
  'An active category cannot have a deleted parent',
  'Category parent change would create a cycle',
] as const;
const CATEGORY_DELETE_CONFLICTS = ['Cannot soft-delete category'] as const;

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ApplicationCacheService,
  ) {}

  async findTree(): Promise<CategoryTreeNode[]> {
    return this.cache.remember(
      CacheNamespace.Categories,
      'tree',
      CATALOG_CACHE_TTL_MILLISECONDS,
      async () => {
        const rows = await this.prisma.$queryRaw<CategoryTreeRow[]>`
          SELECT
            id,
            parent_id AS "parentId",
            name,
            slug::text AS slug,
            description,
            sort_order AS "sortOrder",
            depth
          FROM category_tree
          WHERE deleted_at IS NULL
          ORDER BY sort_path, name_path, id_path
        `;

        return this.buildForest(rows);
      },
    );
  }

  async findSubtree(categoryId: string): Promise<CategoryTreeNode> {
    const rows = await this.prisma.$queryRaw<CategoryTreeRow[]>`
      SELECT
        subtree.id,
        subtree.parent_id AS "parentId",
        subtree.name,
        subtree.slug::text AS slug,
        category.description,
        category.sort_order AS "sortOrder",
        subtree.depth
      FROM category_subtree(${categoryId}::uuid, false) AS subtree
      JOIN categories AS category ON category.id = subtree.id
      ORDER BY subtree.depth, category.sort_order, category.name, subtree.id
    `;

    const [root] = this.buildForest(rows);
    if (!root) {
      throw this.categoryNotFound();
    }

    return root;
  }

  async findOne(categoryId: string): Promise<CategoryRecord> {
    const category = await this.prisma.category.findUnique({
      where: {
        id: categoryId,
        deletedAt: null,
      },
      select: CATEGORY_SELECT,
    });

    if (!category) {
      throw this.categoryNotFound();
    }

    return category;
  }

  async create(input: CreateCategoryDto): Promise<CategoryRecord> {
    try {
      const category = await this.prisma.category.create({
        data: {
          name: input.name.trim(),
          slug: normalizeSlug(input.slug),
          description: input.description ?? null,
          sortOrder: input.sortOrder,
          ...(input.parentId
            ? {
                parent: {
                  connect: {
                    id: input.parentId,
                    deletedAt: null,
                  },
                },
              }
            : {}),
        },
        select: CATEGORY_SELECT,
      });
      await this.invalidateCatalogCaches();
      return category;
    } catch (error: unknown) {
      return this.rethrowWriteError(error, 'create');
    }
  }

  async update(
    categoryId: string,
    input: UpdateCategoryDto,
  ): Promise<CategoryRecord> {
    if (!this.hasUpdates(input)) {
      throw new BadRequestException('At least one category field is required');
    }

    try {
      const category = await this.prisma.category.update({
        where: {
          id: categoryId,
          deletedAt: null,
        },
        data: {
          name: input.name?.trim(),
          slug:
            input.slug === undefined ? undefined : normalizeSlug(input.slug),
          description: input.description,
          sortOrder: input.sortOrder,
          parent:
            input.parentId === undefined
              ? undefined
              : input.parentId === null
                ? { disconnect: true }
                : {
                    connect: {
                      id: input.parentId,
                      deletedAt: null,
                    },
                  },
        },
        select: CATEGORY_SELECT,
      });
      await this.invalidateCatalogCaches();
      return category;
    } catch (error: unknown) {
      return this.rethrowWriteError(
        error,
        'update',
        categoryId,
        input.parentId,
      );
    }
  }

  async softDelete(categoryId: string): Promise<void> {
    try {
      await this.prisma.category.update({
        where: {
          id: categoryId,
          deletedAt: null,
        },
        data: {
          deletedAt: new Date(),
        },
        select: {
          id: true,
        },
      });
      await this.invalidateCatalogCaches();
    } catch (error: unknown) {
      return this.rethrowWriteError(error, 'delete', categoryId);
    }
  }

  private buildForest(rows: readonly CategoryTreeRow[]): CategoryTreeNode[] {
    const nodes = new Map<string, CategoryTreeNode>();
    const roots: CategoryTreeNode[] = [];

    for (const row of rows) {
      nodes.set(row.id, { ...row, children: [] });
    }

    for (const row of rows) {
      const node = nodes.get(row.id);
      if (!node) {
        continue;
      }

      const parent = row.parentId ? nodes.get(row.parentId) : undefined;
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  private invalidateCatalogCaches(): Promise<void> {
    return this.cache.invalidate(
      CacheNamespace.Categories,
      CacheNamespace.ProductCatalog,
    );
  }

  private hasUpdates(input: UpdateCategoryDto): boolean {
    return (
      input.name !== undefined ||
      input.slug !== undefined ||
      input.description !== undefined ||
      input.parentId !== undefined ||
      input.sortOrder !== undefined
    );
  }

  private async rethrowWriteError(
    error: unknown,
    operation: 'create' | 'update' | 'delete',
    categoryId?: string,
    requestedParentId?: string | null,
  ): Promise<never> {
    if (isPrismaKnownRequestError(error, 'P2002')) {
      throw new ConflictException('Category slug is already in use');
    }

    if (isPrismaKnownRequestError(error, 'P2025')) {
      if (operation === 'create') {
        throw new BadRequestException(
          'Parent category must exist and be active',
        );
      }

      // An update containing a nested parent connection can fail because either
      // the target category or its requested parent disappeared from the active
      // set. Resolve that ambiguity only on the error path.
      if (operation === 'update' && categoryId && requestedParentId) {
        const targetStillExists = await this.prisma.category.findUnique({
          where: {
            id: categoryId,
            deletedAt: null,
          },
          select: {
            id: true,
          },
        });

        if (targetStillExists) {
          throw new BadRequestException(
            'Parent category must exist and be active',
          );
        }
      }

      throw this.categoryNotFound();
    }

    const databaseError = getPrismaDatabaseError(error);
    if (
      databaseError?.code === CATEGORY_TRIGGER_ERROR_CODE &&
      CATEGORY_PARENT_ERRORS.some((message) =>
        databaseError.message.includes(message),
      )
    ) {
      throw new BadRequestException('Invalid category parent');
    }

    if (
      databaseError?.code === CATEGORY_TRIGGER_ERROR_CODE &&
      CATEGORY_DELETE_CONFLICTS.some((message) =>
        databaseError.message.includes(message),
      )
    ) {
      throw new ConflictException(
        'Category must have no active children or products before deletion',
      );
    }

    throw error;
  }

  private categoryNotFound(): NotFoundException {
    return new NotFoundException('Category not found');
  }
}
