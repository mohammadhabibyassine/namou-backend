export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_VALIDATION_MESSAGE =
  'must contain only lowercase letters, numbers, and single hyphens';

// PostgreSQL NUMERIC(12, 2): at most ten integer digits and two decimals.
export const MONEY_12_2_PATTERN = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;

export const POSTGRES_INTEGER_MAX = 2_147_483_647;
