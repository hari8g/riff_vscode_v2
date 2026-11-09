export interface Plate {
  text: string;
  region: string;
  checksum?: number;
}

const PLATE_RE = /^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/;

/** Indian HSRP-style plate validation with an optional checksum. */
export function validatePlate(plate: Plate): boolean {
  if (!PLATE_RE.test(plate.text)) return false;
  if (plate.checksum === undefined) return true;
  return plateChecksum(plate.text) === plate.checksum;
}

export function plateChecksum(text: string): number {
  let sum = 0;
  for (const ch of text) sum = (sum * 31 + ch.charCodeAt(0)) % 97;
  return sum;
}

export function normalizePlate(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}
