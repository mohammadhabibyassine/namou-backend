import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePresignedUrlDto } from './create-presigned-url.dto.js';

describe('CreatePresignedUrlDto', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])(
    'accepts %s within the product image size limit',
    async (contentType) => {
      const dto = plainToInstance(CreatePresignedUrlDto, {
        contentType,
        fileSizeBytes: 5_000_000,
      });
      await expect(validate(dto)).resolves.toHaveLength(0);
    },
  );

  it('rejects disallowed content types', async () => {
    const dto = plainToInstance(CreatePresignedUrlDto, {
      contentType: 'application/pdf',
      fileSizeBytes: 1_000,
    });
    const errors = await validate(dto);
    expect(errors.map(({ property }) => property)).toContain('contentType');
  });

  it.each([0, 10 * 1024 * 1024 + 1])(
    'rejects an unsafe file size of %s bytes',
    async (fileSizeBytes) => {
      const dto = plainToInstance(CreatePresignedUrlDto, {
        contentType: 'image/png',
        fileSizeBytes,
      });
      const errors = await validate(dto);
      expect(errors.map(({ property }) => property)).toContain('fileSizeBytes');
    },
  );
});
