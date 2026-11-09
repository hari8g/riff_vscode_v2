import type { DisputeQueue } from '../disputes/queue.js';
import type { Dispute } from '../disputes/dispute.js';
import type { SessionStore } from '../toll/store.js';
import { nextId } from '../util/ids.js';

export interface HttpRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

/** Minimal request router for the operator API; a real deployment mounts these on a web framework. */
export class ApiHandlers {
  constructor(private readonly sessions: SessionStore, private readonly disputes: DisputeQueue) {}

  handle(req: HttpRequest, now: number): HttpResponse {
    if (req.method === 'GET' && req.path.startsWith('/sessions/')) return this.getSession(req.path.slice('/sessions/'.length));
    if (req.method === 'POST' && req.path === '/disputes') return this.openDispute(req.body ?? {}, now);
    return { status: 404, body: { error: 'not found' } };
  }

  private getSession(id: string): HttpResponse {
    const s = this.sessions.get(id);
    return s ? { status: 200, body: { id: s.id, state: s.state, plate: s.plate.text } } : { status: 404, body: { error: 'no such session' } };
  }

  private openDispute(body: Record<string, unknown>, now: number): HttpResponse {
    const sessionId = String(body['sessionId'] ?? '');
    if (!this.sessions.get(sessionId)) return { status: 400, body: { error: 'unknown session' } };
    const d: Dispute = { id: nextId('dsp'), sessionId, reason: 'other', status: 'open', openedAt: now };
    return this.disputes.enqueue(d) ? { status: 201, body: d } : { status: 409, body: { error: 'disputes disabled or duplicate' } };
  }
}
