import { rupees } from '../util/money.js';

/** Message templates; keep them short enough for one SMS segment (160 chars). */
export function chargeMessage(plate: string, paise: number, plaza: string): string {
  return `Toll of ${rupees(paise)} charged for ${plate} at ${plaza}.`;
}

export function disputeMessage(plate: string, status: string): string {
  return `Your dispute for ${plate} is ${status}.`;
}

export function fitsOneSms(text: string): boolean {
  return text.length <= 160;
}
