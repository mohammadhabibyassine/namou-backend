import { BadRequestException } from '@nestjs/common';
import { prepareVariantConfiguration } from './variant-configuration.js';

const color = 'eef702a8-4954-4c71-a747-a5179113b82e';
const size = '450d6587-3978-42f7-8c23-b8dcd179f94b';
const red = 'ef976445-6be6-4eb4-879b-3f312baf5fbc';
const medium = 'e23c6a73-aeeb-41e9-baa5-b8709d49ce72';

describe('prepareVariantConfiguration', () => {
  it('normalizes a multi-attribute variant and derives offered values', () => {
    const result = prepareVariantConfiguration(
      [
        { attributeTypeId: color, sortOrder: 0 },
        { attributeTypeId: size, sortOrder: 1 },
      ],
      [
        {
          sku: ' red-medium ',
          priceOverride: '25.00',
          stockQuantity: 3,
          isDefault: true,
          options: [
            { attributeTypeId: color, attributeValueId: red },
            { attributeTypeId: size, attributeValueId: medium },
          ],
        },
      ],
    );

    expect(result.variants[0]).toMatchObject({
      sku: 'RED-MEDIUM',
      priceOverride: '25.00',
    });
    expect(result.offeredAttributeValues).toEqual(
      expect.arrayContaining([
        { attributeTypeId: color, attributeValueId: red },
        { attributeTypeId: size, attributeValueId: medium },
      ]),
    );
  });

  it.each([
    {
      attributes: [] as Array<{ attributeTypeId: string; sortOrder: number }>,
      variants: [
        {
          sku: 'ONE',
          stockQuantity: 1,
          isDefault: true,
          options: [],
        },
        {
          sku: 'TWO',
          stockQuantity: 1,
          isDefault: false,
          options: [],
        },
      ],
      message: 'A product without attributes must have exactly one variant',
    },
    {
      attributes: [{ attributeTypeId: color, sortOrder: 0 }],
      variants: [
        {
          sku: 'ONE',
          stockQuantity: 1,
          isDefault: true,
          options: [],
        },
      ],
      message:
        'Variant ONE must have exactly one option for every configured attribute type',
    },
    {
      attributes: [],
      variants: [
        {
          sku: 'ONE',
          stockQuantity: 1,
          isDefault: false,
          options: [],
        },
      ],
      message: 'A product must have exactly one default variant',
    },
  ])('rejects an invalid matrix', ({ attributes, variants, message }) => {
    expect(() => prepareVariantConfiguration(attributes, variants)).toThrow(
      new BadRequestException(message),
    );
  });
});
