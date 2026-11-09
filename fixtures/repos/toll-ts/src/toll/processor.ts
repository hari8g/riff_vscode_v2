import type { FeatureFlags } from '../config/flags.js';
import { ReadingDeduper } from '../gantry/dedupe.js';
import { isTrusted, type GantryReading } from '../gantry/reading.js';
import type { Notifier } from '../notify/notifier.js';
import { chargeMessage } from '../notify/templates.js';
import type { PricingEngine } from '../pricing/engine.js';
import { nextId } from '../util/ids.js';
import type { Ledger } from './ledger.js';
import { normalizePlate } from './plate.js';
import { TollSession } from './session.js';
import type { SessionStore } from './store.js';

/** Turns gantry readings into charged sessions: dedupe → trust check → price → close → notify. */
export class PassageProcessor {
  private readonly deduper = new ReadingDeduper();
  readonly manualReview: GantryReading[] = [];

  constructor(
    private readonly store: SessionStore,
    private readonly ledger: Ledger,
    private readonly pricing: PricingEngine,
    private readonly flags: FeatureFlags,
    private readonly notifier: Notifier,
    private readonly plazaId: string,
  ) {}

  async process(raw: GantryReading): Promise<TollSession | undefined> {
    const r = this.deduper.accept({ ...raw, plate: { ...raw.plate, text: normalizePlate(raw.plate.text) } });
    if (!r) return undefined;
    if (!isTrusted(r)) {
      this.manualReview.push(r);
      return undefined;
    }
    const session = new TollSession(nextId('ses'), r.plate, this.ledger, this.flags);
    this.store.put(session);
    const amount = this.pricing.quote(r, this.plazaId);
    session.close(amount);
    if (session.state === 'closed') await this.notifier.send(r.plate.text, chargeMessage(r.plate.text, amount, this.plazaId));
    return session;
  }
}
