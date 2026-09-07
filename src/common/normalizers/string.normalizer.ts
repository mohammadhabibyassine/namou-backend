export function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}
