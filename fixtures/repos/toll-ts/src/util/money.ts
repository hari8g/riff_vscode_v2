/** Amounts are integer paise throughout; these helpers keep rupee formatting in one place. */
export function rupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}₹${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function addPaise(a: number, b: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error('paise must be integers');
  return a + b;
}

/** Applies a percentage discount, rounding half up to the paisa. */
export function discount(paise: number, percent: number): number {
  if (percent < 0 || percent > 100) throw new Error('percent out of range');
  return paise - Math.round((paise * percent) / 100);
}
