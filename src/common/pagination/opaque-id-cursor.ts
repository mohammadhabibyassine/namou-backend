import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

interface IdCursorPayload {
  version: 1;
  id: string;
  contextHash: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Produces an opaque cursor tied to one authenticated/filter context.
 *
 * The context hash is not an authorization mechanism; queries must still be
 * scoped in the database. It prevents accidental reuse across users, admin
 * listings, or changed filters.
 */
export function encodeIdCursor(id: string, context: string): string {
  const payload: IdCursorPayload = {
    version: 1,
    id,
    contextHash: hashContext(context),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeIdCursor(encoded: string, context: string): string {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Invalid encoding');
    const parsed: unknown = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    );
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      typeof parsed.id !== 'string' ||
      !UUID_PATTERN.test(parsed.id) ||
      parsed.contextHash !== hashContext(context)
    ) {
      throw new Error('Invalid cursor payload');
    }
    return parsed.id;
  } catch {
    throw new BadRequestException(
      'cursor is invalid or does not match the requested filters',
    );
  }
}

function hashContext(context: string): string {
  return createHash('sha256').update(context).digest('base64url').slice(0, 22);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
