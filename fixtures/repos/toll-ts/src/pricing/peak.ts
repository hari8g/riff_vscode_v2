/** Peak windows add a surcharge; hours are local 0–23, end exclusive. */
export interface PeakWindow {
  startHour: number;
  endHour: number;
  surchargePercent: number;
}

export const DEFAULT_PEAKS: readonly PeakWindow[] = [
  { startHour: 8, endHour: 11, surchargePercent: 10 },
  { startHour: 17, endHour: 20, surchargePercent: 10 },
];

export function isPeak(hour: number, windows: readonly PeakWindow[] = DEFAULT_PEAKS): PeakWindow | undefined {
  return windows.find((w) => hour >= w.startHour && hour < w.endHour);
}

export function applySurcharge(paise: number, w: PeakWindow | undefined): number {
  if (!w) return paise;
  return paise + Math.round((paise * w.surchargePercent) / 100);
}
