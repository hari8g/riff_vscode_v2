/** Small system ports so every layer is testable without touching the real clock or disk. */

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export class FixedClock implements Clock {
  constructor(private at: Date) {}
  now(): Date {
    return this.at;
  }
  advance(ms: number): void {
    this.at = new Date(this.at.getTime() + ms);
  }
}

export interface FileStat {
  size: number;
  mtimeMs: number;
  isDirectory: boolean;
}

export interface Fs {
  readFile(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  stat(path: string): Promise<FileStat | undefined>;
  readdir(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
}
