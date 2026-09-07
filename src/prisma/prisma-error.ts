import { Prisma } from '../generated/prisma/client.js';

export interface PrismaDatabaseError {
  code: string;
  message: string;
}

export function isPrismaKnownRequestError(
  error: unknown,
  code: string,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

/**
 * Extracts the original PostgreSQL error wrapped by Prisma's driver adapter.
 *
 * Prisma maps failed raw queries to P2010 and driver-adapter failures without
 * a dedicated Prisma code to P2039. Both can wrap PostgreSQL exceptions raised
 * by our functions and triggers. Keep the adapter-specific shape isolated here
 * so domain services do not depend directly on Prisma's nested error metadata.
 */
export function getPrismaDatabaseError(
  error: unknown,
): PrismaDatabaseError | null {
  if (
    !isPrismaKnownRequestError(error, 'P2010') &&
    !isPrismaKnownRequestError(error, 'P2039')
  ) {
    return null;
  }

  const driverAdapterError = getRecordValue(error.meta, 'driverAdapterError');
  const cause = getRecordValue(driverAdapterError, 'cause');
  const code = getStringValue(cause, 'originalCode');
  const message = getStringValue(cause, 'originalMessage');

  return code && message ? { code, message } : null;
}

function getRecordValue(
  value: unknown,
  key: string,
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const nestedValue = value[key];
  return isRecord(nestedValue) ? nestedValue : null;
}

function getStringValue(
  value: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!value) {
    return null;
  }

  const nestedValue = value[key];
  return typeof nestedValue === 'string' ? nestedValue : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
