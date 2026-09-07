import { BadRequestException } from '@nestjs/common';
import { decodeIdCursor, encodeIdCursor } from './opaque-id-cursor.js';

describe('opaque ID cursor', () => {
  const id = '27ef665b-082b-4a66-8c40-a256cf7966b1';
  const context = 'orders:user-id:pending';

  it('round-trips a UUID without serializing a lossy timestamp', () => {
    const encoded = encodeIdCursor(id, context);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeIdCursor(encoded, context)).toBe(id);
  });

  it('rejects reuse with a different filter context', () => {
    const encoded = encodeIdCursor(id, context);
    expect(() => decodeIdCursor(encoded, 'orders:user-id:confirmed')).toThrow(
      BadRequestException,
    );
  });

  it.each(['not json', 'e30', Buffer.from('{}').toString('base64url')])(
    'rejects malformed cursor %s',
    (encoded) => {
      expect(() => decodeIdCursor(encoded, context)).toThrow(
        BadRequestException,
      );
    },
  );
});
