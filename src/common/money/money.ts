export interface FixedPointDecimal {
  toFixed(fractionDigits: number): string;
}

export function formatMoney(value: FixedPointDecimal): string {
  return value.toFixed(2);
}

export function compareMoney(left: string, right: string): number {
  const leftMinorUnits = toMinorUnits(left);
  const rightMinorUnits = toMinorUnits(right);

  if (leftMinorUnits === rightMinorUnits) {
    return 0;
  }

  return leftMinorUnits < rightMinorUnits ? -1 : 1;
}

function toMinorUnits(value: string): bigint {
  const [integerPart, fractionPart = ''] = value.split('.');
  return BigInt(integerPart) * 100n + BigInt(fractionPart.padEnd(2, '0'));
}
