/** TelemetrySink — where the governor records what happened. The store implements it; tests use memory. */

export type TelemetryKind =
  | 'session.start'
  | 'session.end'
  | 'route'
  | 'pack.compiled'
  | 'pack.item.read'
  | 'tool.call'
  | 'tool.decision'
  | 'test.result'
  | 'clarify.asked'
  | 'skill.distilled';

export interface TelemetryEvent {
  sessionId: string;
  kind: TelemetryKind;
  at: string; // ISO timestamp
  payload: Record<string, unknown>;
}

export interface TelemetrySink {
  record(event: TelemetryEvent): Promise<void> | void;
}

export class MemoryTelemetrySink implements TelemetrySink {
  readonly events: TelemetryEvent[] = [];
  record(event: TelemetryEvent): void {
    this.events.push(event);
  }
}
