import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { ApplicationCacheService } from '../cache/application-cache.service.js';
import { ProductSort } from './products.constants.js';
import type { ProductsRepository } from './products.repository.js';
import { ProductsService } from './products.service.js';
import type {
  ProductListDatabaseRow,
  ProductListItem,
} from './products.types.js';

const productId = 'a3d73b17-64f4-4c95-b1b5-60c8bf80551b';
const secondProductId = 'b3d73b17-64f4-4c95-b1b5-60c8bf80551b';
const thirdProductId = 'c3d73b17-64f4-4c95-b1b5-60c8bf80551b';
const createdAt = new Date('2026-01-02T00:00:00.000Z');

function listRow(
  overrides: Partial<ProductListDatabaseRow> = {},
): ProductListDatabaseRow {
  return {
    id: productId,
    title: 'Leather boots',
    slug: 'leather-boots',
    currencyCode: 'USD',
    minimumPrice: new Prisma.Decimal('99.9'),
    maximumPrice: new Prisma.Decimal('119'),
    inStock: true,
    primaryImageUrl: 'https://images.example/boots.webp',
    categoryId: 'category-id',
    categoryName: 'Shoes',
    categorySlug: 'shoes',
    relevance: 0.5,
    createdAt,
    cursorCreatedAt: '2026-01-02T00:00:00.000123Z',
    ...overrides,
  };
}

describe('ProductsService', () => {
  const remember = vi.fn(
    async (
      _namespace: string,
      _key: string,
      _ttl: number,
      loader: () => Promise<unknown>,
    ) => loader(),
  );
  const cache = { remember } as unknown as ApplicationCacheService;
  const findCatalogPage = vi.fn();
  const findCatalogFacets = vi.fn();
  const findActiveDetailBySlug = vi.fn();
  const repository = {
    findCatalogPage,
    findCatalogFacets,
    findActiveDetailBySlug,
  } as unknown as ProductsRepository;
  const service = new ProductsService(repository, cache);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('groups public catalog facets and formats currency ranges', async () => {
    findCatalogFacets.mockResolvedValue({
      attributes: [
        {
          attributeTypeId: 'eef702a8-4954-4c71-a747-a5179113b82e',
          attributeTypeName: 'Color',
          attributeTypeSlug: 'color',
          attributeTypeSortOrder: 0,
          attributeValueId: 'ef976445-6be6-4eb4-879b-3f312baf5fbc',
          attributeValue: 'Red',
          attributeValueSortOrder: 0,
        },
        {
          attributeTypeId: 'eef702a8-4954-4c71-a747-a5179113b82e',
          attributeTypeName: 'Color',
          attributeTypeSlug: 'color',
          attributeTypeSortOrder: 0,
          attributeValueId: 'e23c6a73-aeeb-41e9-baa5-b8709d49ce72',
          attributeValue: 'Blue',
          attributeValueSortOrder: 1,
        },
      ],
      priceRanges: [
        {
          currencyCode: 'USD',
          minimumPrice: new Prisma.Decimal('20'),
          maximumPrice: new Prisma.Decimal('29.9'),
        },
      ],
    });

    await expect(
      service.findCatalogFacets({ currencyCode: 'USD' }),
    ).resolves.toEqual({
      attributes: [
        {
          id: 'eef702a8-4954-4c71-a747-a5179113b82e',
          name: 'Color',
          slug: 'color',
          sortOrder: 0,
          values: [
            {
              id: 'ef976445-6be6-4eb4-879b-3f312baf5fbc',
              value: 'Red',
              sortOrder: 0,
            },
            {
              id: 'e23c6a73-aeeb-41e9-baa5-b8709d49ce72',
              value: 'Blue',
              sortOrder: 1,
            },
          ],
        },
      ],
      priceRanges: [
        {
          currencyCode: 'USD',
          minimumPrice: '20.00',
          maximumPrice: '29.90',
        },
      ],
    });
  });

  it('defaults searched catalogs to relevance and emits an opaque next cursor', async () => {
    findCatalogPage.mockResolvedValue([
      listRow(),
      listRow({ id: secondProductId, relevance: 0.4 }),
      listRow({ id: thirdProductId, relevance: 0.3 }),
    ]);

    const result = await service.findCatalogPage({
      search: 'boots',
      attributeValueIds: [],
      pageSize: 2,
    });

    expect(findCatalogPage).toHaveBeenCalledWith(
      expect.objectContaining({
        search: 'boots',
        sort: ProductSort.Relevance,
        pageSize: 2,
      }),
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject<Partial<ProductListItem>>({
      minimumPrice: '99.90',
      maximumPrice: '119.00',
    });
    expect(result.pageInfo).toEqual({
      hasNextPage: true,
      endCursor: expect.any(String),
    });
  });

  it('decodes a matching cursor and rejects cursor reuse with another sort', async () => {
    findCatalogPage.mockResolvedValue([listRow()]);
    const firstPage = await service.findCatalogPage({
      attributeValueIds: [],
      pageSize: 20,
      sort: ProductSort.PriceAscending,
    });

    await service.findCatalogPage({
      attributeValueIds: [],
      pageSize: 20,
      sort: ProductSort.PriceAscending,
      cursor: firstPage.pageInfo.endCursor ?? undefined,
    });
    expect(findCatalogPage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cursor: {
          version: 1,
          sort: ProductSort.PriceAscending,
          filterHash: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
          value: '99.90',
          id: productId,
        },
      }),
    );

    await expect(
      service.findCatalogPage({
        attributeValueIds: [],
        pageSize: 20,
        sort: ProductSort.Newest,
        cursor: firstPage.pageInfo.endCursor ?? undefined,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an inverted price range before querying', async () => {
    await expect(
      service.findCatalogPage({
        attributeValueIds: [],
        pageSize: 20,
        minPrice: '100.00',
        maxPrice: '99.99',
      }),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      message: 'minPrice must be less than or equal to maxPrice',
    });
    expect(findCatalogPage).not.toHaveBeenCalled();
  });

  it('maps the normalized product detail into a client-focused variant shape', async () => {
    findActiveDetailBySlug.mockResolvedValue({
      id: productId,
      title: 'Leather boots',
      slug: 'leather-boots',
      description: null,
      basePrice: new Prisma.Decimal('100'),
      currencyCode: 'USD',
      createdAt,
      updatedAt: createdAt,
      category: {
        id: 'category-id',
        name: 'Shoes',
        slug: 'shoes',
      },
      images: [],
      attributeTypes: [
        {
          sortOrder: 0,
          attributeType: {
            id: 'color-id',
            name: 'Color',
            slug: 'color',
          },
          attributeValues: [
            {
              attributeValue: {
                id: 'red-id',
                value: 'Red',
                sortOrder: 0,
              },
            },
          ],
        },
      ],
      variants: [
        {
          id: 'variant-id',
          sku: 'BOOT-RED',
          priceOverride: null,
          effectivePrice: new Prisma.Decimal('100'),
          stockQuantity: 4,
          isDefault: true,
          attributeValues: [
            {
              attributeTypeId: 'color-id',
              attributeValueId: 'red-id',
            },
          ],
        },
      ],
    });

    const result = await service.findBySlug('  LEATHER-BOOTS  ');

    expect(findActiveDetailBySlug).toHaveBeenCalledWith('leather-boots');
    expect(result).toMatchObject({
      basePrice: '100.00',
      variants: [
        {
          effectivePrice: '100.00',
          options: [
            {
              attributeTypeSlug: 'color',
              value: 'Red',
            },
          ],
        },
      ],
    });
  });

  it('returns not found for hidden products and detects impossible variant drift', async () => {
    findActiveDetailBySlug.mockResolvedValueOnce(null);
    await expect(service.findBySlug('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    findActiveDetailBySlug.mockResolvedValueOnce({
      id: productId,
      title: 'Broken product',
      slug: 'broken-product',
      description: null,
      basePrice: new Prisma.Decimal('10'),
      currencyCode: 'USD',
      createdAt,
      updatedAt: createdAt,
      category: { id: 'category-id', name: 'Shoes', slug: 'shoes' },
      images: [],
      attributeTypes: [],
      variants: [
        {
          id: 'variant-id',
          sku: 'BROKEN',
          priceOverride: null,
          effectivePrice: new Prisma.Decimal('10'),
          stockQuantity: 1,
          isDefault: true,
          attributeValues: [
            {
              attributeTypeId: 'missing-type',
              attributeValueId: 'missing-value',
            },
          ],
        },
      ],
    });

    await expect(service.findBySlug('broken-product')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
