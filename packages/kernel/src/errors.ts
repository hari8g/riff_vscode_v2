/** Result type: layers return errors as values at boundaries instead of throwing across packages. */
export type Result<T, E = RiafError> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const ERROR_CODES = [
  'invalid_input',
  'not_found',
  'conflict',
  'store_failure',
  'parse_failure',
  'git_failure',
  'model_failure',
  'budget_exceeded',
  'policy_invalid',
  'rpc_failure',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class RiafError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'RiafError';
  }

  toJSON(): { code: ErrorCode; message: string; details?: Record<string, unknown> } {
    return this.details ? { code: this.code, message: this.message, details: this.details } : { code: this.code, message: this.message };
  }
}

/** Wraps an unknown thrown value into a RiafError without losing the original. */
export function toRiafError(e: unknown, code: ErrorCode = 'internal'): RiafError {
  if (e instanceof RiafError) return e;
  if (e instanceof Error) return new RiafError(code, e.message, undefined, { cause: e });
  return new RiafError(code, String(e));
}
