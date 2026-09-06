import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAddressDto } from './address.dto.js';

describe('UpdateAddressDto', () => {
  it('does not inherit the create DTO default for an omitted isDefault', async () => {
    const dto = plainToInstance(UpdateAddressDto, { city: 'Beirut' });
    expect(dto.isDefault).toBeUndefined();
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('retains an explicitly supplied false', async () => {
    const dto = plainToInstance(UpdateAddressDto, { isDefault: false });
    expect(dto.isDefault).toBe(false);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});
