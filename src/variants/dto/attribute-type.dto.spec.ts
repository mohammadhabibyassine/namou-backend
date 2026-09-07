import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  UpdateAttributeTypeDto,
  UpdateAttributeValueDto,
} from './attribute-type.dto.js';

describe('attribute PATCH DTOs', () => {
  it.each([UpdateAttributeTypeDto, UpdateAttributeValueDto])(
    'does not turn an omitted sortOrder into zero for %o',
    async (Dto) => {
      const dto = plainToInstance(Dto, {});
      expect(dto.sortOrder).toBeUndefined();
      await expect(validate(dto)).resolves.toHaveLength(0);
    },
  );
});
