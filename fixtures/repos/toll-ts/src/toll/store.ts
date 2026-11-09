import type { TollSession } from './session.js';

/** Session lookup by id; in-memory implementation for the fixture. */
export class SessionStore {
  private readonly byId = new Map<string, TollSession>();

  put(s: TollSession): void {
    this.byId.set(s.id, s);
  }

  get(id: string): TollSession | undefined {
    return this.byId.get(id);
  }

  openSessions(): TollSession[] {
    return [...this.byId.values()].filter((s) => s.state === 'open');
  }
}
