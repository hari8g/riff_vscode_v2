/** Output sink so commands are testable without touching process.stdout. */
export interface Io {
  out(text: string): void;
  err(text: string): void;
  cwd: string;
  /** Colour/glyphs on a TTY; plain otherwise. */
  tty: boolean;
}

export const processIo = (): Io => ({
  out: (t) => process.stdout.write(t.endsWith('\n') ? t : `${t}\n`),
  err: (t) => process.stderr.write(t.endsWith('\n') ? t : `${t}\n`),
  cwd: process.cwd(),
  tty: Boolean(process.stdout.isTTY),
});

/** Collects output in memory (tests). */
export function memoryIo(cwd: string): Io & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { out: (t) => stdout.push(t), err: (t) => stderr.push(t), cwd, tty: false, stdout, stderr };
}
