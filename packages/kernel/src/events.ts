/**
 * Typed event bus. Pipeline stages publish progress; the daemon forwards to clients; the
 * governor publishes telemetry. Listeners never throw into publishers.
 */

export type EventMap = Record<string, unknown>;

export type Listener<T> = (payload: T) => void;

export interface Unsubscribe {
  (): void;
}

export class EventBus<E extends EventMap> {
  private readonly listeners = new Map<keyof E, Set<Listener<unknown>>>();

  on<K extends keyof E>(event: K, listener: Listener<E[K]>): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<unknown>);
    return () => {
      set?.delete(listener as Listener<unknown>);
    };
  }

  once<K extends keyof E>(event: K, listener: Listener<E[K]>): Unsubscribe {
    const off = this.on(event, (p) => {
      off();
      listener(p);
    });
    return off;
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const l of [...set]) {
      try {
        l(payload);
      } catch {
        // a failing listener must not break the publisher
      }
    }
  }

  listenerCount(event: keyof E): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

/** Events every pipeline stage emits; the daemon maps them onto RPC notifications. */
export interface PipelineEvents extends EventMap {
  'stage:start': { stage: string; pending: number };
  'stage:progress': { stage: string; done: number; total: number };
  'stage:end': { stage: string; changed: number; ms: number };
  'stage:error': { stage: string; error: string };
}
