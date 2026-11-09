export type FlagName = 'charge-on-close' | 'strict-checksum' | 'dispute-queue';

/** Operator-controlled feature flags, loaded from the environment at boot. */
export class FeatureFlags {
  private readonly enabled = new Set<FlagName>();

  constructor(initial: readonly FlagName[] = ['charge-on-close']) {
    for (const f of initial) this.enabled.add(f);
  }

  isEnabled(flag: FlagName): boolean {
    return this.enabled.has(flag);
  }

  set(flag: FlagName, on: boolean): void {
    if (on) this.enabled.add(flag);
    else this.enabled.delete(flag);
  }

  static fromEnv(env: Record<string, string | undefined>): FeatureFlags {
    const raw = env['TOLL_FLAGS'] ?? '';
    const names = raw.split(',').map((s) => s.trim()).filter(Boolean) as FlagName[];
    return new FeatureFlags(names.length ? names : undefined);
  }
}
