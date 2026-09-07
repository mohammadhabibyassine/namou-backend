import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCategoryDto } from './create-category.dto.js';
import { UpdateCategoryDto } from './update-category.dto.js';

describe('Category DTOs', () => {
  it('normalizes category text and a canonical URL slug', async () => {
    const input = plainToInstance(CreateCategoryDto, {
      name: '  Men Shoes  ',
      slug: '  MEN-SHOES  ',
      description: '  Everyday footwear  ',
      sortOrder: 10,
    });

    await expect(validate(input)).resolves.toHaveLength(0);
    expect(input).toMatchObject({
      name: 'Men Shoes',
      slug: 'men-shoes',
      description: 'Everyday footwear',
      sortOrder: 10,
    });
  });

  it('rejects malformed slugs, non-v4 parents, and non-integer ordering', async () => {
    const input = plainToInstance(CreateCategoryDto, {
      name: 'Shoes',
      slug: 'men shoes',
      parentId: 'not-a-uuid',
      sortOrder: 1.5,
    });

    const errors = await validate(input);
    expect(errors.map(({ property }) => property)).toEqual(
      expect.arrayContaining(['slug', 'parentId', 'sortOrder']),
    );
  });

  it('keeps PATCH fields optional and accepts null to clear a parent or description', async () => {
    const emptyUpdate = plainToInstance(UpdateCategoryDto, {});
    const clearingUpdate = plainToInstance(UpdateCategoryDto, {
      parentId: null,
      description: null,
    });

    await expect(validate(emptyUpdate)).resolves.toHaveLength(0);
    await expect(validate(clearingUpdate)).resolves.toHaveLength(0);
  });
});
