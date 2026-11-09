let counter = 0;

/** Monotonic, process-unique ids with a readable prefix (`ses-1`, `tx-2`). */
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** Resets the counter; tests only. */
export function resetIds(): void {
  counter = 0;
}
