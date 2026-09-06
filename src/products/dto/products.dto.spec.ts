import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductDto } from './create-product.dto.js';
import { ListProductsQueryDto } from './list-products-query.dto.js';
import { ProductSlugParamsDto } from './product-slug-params.dto.js';
import { UpdateProductDto } from './update-product.dto.js';

const firstValueId = 'cab73b17-64f4-4c95-b1b5-60c8bf80551b';
const secondValueId = '52222047-df0f-423a-bac1-95e409d910df';

describe('Product query DTOs', () => {
  it('normalizes filters, de-duplicates comma-separated values, and converts page size', async () => {
    const input = plainToInstance(ListProductsQueryDto, {
      search: '  leather boots  ',
      attributeValueIds: `${firstValueId},${secondValueId},${firstValueId}`,
      minPrice: ' 10.50 ',
      currencyCode: ' usd ',
      pageSize: '40',
    });

    await expect(validate(input)).resolves.toHaveLength(0);
    expect(input).toMatchObject({
      search: 'leather boots',
      attributeValueIds: [firstValueId, secondValueId],
      minPrice: '10.50',
      currencyCode: 'USD',
      pageSize: 40,
    });
  });

  it('rejects excessive filters, malformed money, and oversized pages', async () => {
    const input = plainToInstance(ListProductsQueryDto, {
      attributeValueIds: Array.from(
        { length: 21 },
        (_, index) =>
          `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
      ),
      minPrice: '-1',
      maxPrice: '10.999',
      pageSize: '101',
    });

    const errors = await validate(input);
    expect(errors.map(({ property }) => property)).toEqual(
      expect.arrayContaining([
        'attributeValueIds',
        'minPrice',
        'maxPrice',
        'pageSize',
      ]),
    );
  });

  it('normalizes and validates product slug parameters', async () => {
    const params = plainToInstance(ProductSlugParamsDto, {
      slug: '  LEATHER-BOOTS  ',
    });

    await expect(validate(params)).resolves.toHaveLength(0);
    expect(params.slug).toBe('leather-boots');
  });
});

describe('CreateProductDto', () => {
  it('normalizes a nested product aggregate and applies safe defaults', async () => {
    const input = plainToInstance(CreateProductDto, {
      categoryId: '27ef665b-082b-4a66-8c40-a256cf7966b1',
      title: '  Everyday trainer  ',
      slug: '  EVERYDAY-TRAINER  ',
      basePrice: ' 89.90 ',
      variants: [
        {
          sku: ' trainer-default ',
          isDefault: true,
        },
      ],
    });

    await expect(validate(input)).resolves.toHaveLength(0);
    expect(input).toMatchObject({
      title: 'Everyday trainer',
      slug: 'everyday-trainer',
      basePrice: '89.90',
      currencyCode: 'USD',
      isActive: true,
      attributes: [],
      variants: [
        {
          sku: 'TRAINER-DEFAULT',
          stockQuantity: 0,
          isDefault: true,
          options: [],
        },
      ],
    });
  });

  it('validates nested variants rather than trusting plain objects', async () => {
    const input = plainToInstance(CreateProductDto, {
      categoryId: 'not-a-uuid',
      title: '',
      slug: 'not a slug',
      basePrice: '-1',
      variants: [
        {
          sku: '',
          stockQuantity: -1,
          options: [{ attributeTypeId: 'bad', attributeValueId: 'bad' }],
        },
      ],
    });

    const errors = await validate(input);
    expect(errors.map(({ property }) => property)).toEqual(
      expect.arrayContaining([
        'categoryId',
        'title',
        'slug',
        'basePrice',
        'variants',
      ]),
    );
  });

  it('rejects null for defaulted scalar fields instead of silently accepting it', async () => {
    const input = plainToInstance(CreateProductDto, {
      categoryId: '27ef665b-082b-4a66-8c40-a256cf7966b1',
      title: 'Everyday trainer',
      slug: 'everyday-trainer',
      basePrice: '89.90',
      currencyCode: null,
      isActive: null,
      variants: [
        {
          sku: 'TRAINER-DEFAULT',
          stockQuantity: null,
          isDefault: null,
        },
      ],
    });

    const errors = await validate(input);
    expect(errors.map(({ property }) => property)).toEqual(
      expect.arrayContaining(['currencyCode', 'isActive', 'variants']),
    );
  });
});

describe('UpdateProductDto', () => {
  it('accepts and normalizes only the metadata fields being patched', async () => {
    const input = plainToInstance(UpdateProductDto, {
      title: '  Renamed trainer  ',
      basePrice: ' 95.50 ',
      currencyCode: ' eur ',
      description: null,
    });

    await expect(validate(input)).resolves.toHaveLength(0);
    expect(input).toMatchObject({
      title: 'Renamed trainer',
      basePrice: '95.50',
      currencyCode: 'EUR',
      description: null,
    });
    expect(input).not.toHaveProperty('slug');
    expect(input).not.toHaveProperty('isActive');
  });

  it('allows omission but rejects null for non-nullable metadata', async () => {
    await expect(
      validate(plainToInstance(UpdateProductDto, {})),
    ).resolves.toHaveLength(0);

    const input = plainToInstance(UpdateProductDto, {
      categoryId: null,
      title: null,
      basePrice: null,
      currencyCode: null,
      isActive: null,
    });
    const errors = await validate(input);

    expect(errors.map(({ property }) => property)).toEqual(
      expect.arrayContaining([
        'categoryId',
        'title',
        'basePrice',
        'currencyCode',
        'isActive',
      ]),
    );
  });
});
