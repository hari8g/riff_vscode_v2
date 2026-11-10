/** Message bridge to the extension host (or the dev server, which provides the same acquireVsCodeApi). */

declare function acquireVsCodeApi(): { postMessage(m: unknown): void; getState(): unknown; setState(s: unknown): void };

export type Msg = { id?: number; type: string; [k: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const vscode = acquireVsCodeApi();
let nextId = 1;
const pending = new Map<number, (v: Msg) => void>();
const subscribers = new Map<string, Set<(m: Msg) => void>>();
window.addEventListener('message', (e: MessageEvent<Msg>) => {
  if (e.data?.type === 'push') {
    for (const fn of subscribers.get(String(e.data['channel'])) ?? []) fn(e.data);
    return;
  }
  const id = e.data?.id;
  const r = id !== undefined ? pending.get(id) : undefined;
  if (r && id !== undefined) {
    pending.delete(id);
    r(e.data);
  }
});

/** Sends one request; rejects when the host answers with an error. */
export function ask(req: Record<string, unknown>): Promise<Msg> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (m) => (m.type === 'error' ? reject(new Error(String(m['message']))) : resolve(m)));
    vscode.postMessage({ ...req, id });
  });
}

/** Listens for messages the host sends unasked (e.g. channel `live`: new Claude Code events). */
export function onPush(channel: string, fn: (m: Msg) => void): () => void {
  const set = subscribers.get(channel) ?? new Set();
  set.add(fn);
  subscribers.set(channel, set);
  return () => set.delete(fn);
}

export const repoRoot = document.body.dataset['repo'] ?? '';
/** Brand asset URLs supplied by the host (webview URIs in VS Code, plain paths in the dev server). */
export const brand = { mps: document.body.dataset['mps'] ?? '' };
export const repoName = repoRoot.split(/[\\/]/).filter(Boolean).pop() ?? 'repository';

/** Per-panel UI state that survives the webview being hidden and shown. */
export function saved<T>(key: string, fallback: T): T {
  const s = (vscode.getState() as Record<string, unknown> | undefined) ?? {};
  return (key in s ? s[key] : fallback) as T;
}
export function save(key: string, value: unknown): void {
  const s = (vscode.getState() as Record<string, unknown> | undefined) ?? {};
  vscode.setState({ ...s, [key]: value });
}

// shapes of what the daemon returns (the subset the console reads)
export interface IntentVector { [intent: string]: number }
export interface TaskUnit { id: string; text: string; anchors: string[]; ungrounded: string[]; w: IntentVector; H: number; dependsOn: string[] }
export interface Policy {
  units: TaskUnit[]; branch: string; w: IntentVector; H: number; primitives: { intent: string; weight: number }[];
  anchors: string[]; expansion: { rule: string; hops?: number; cap?: number }[]; historyScope: string[];
  budget: { total: number; fixed: { map: number; runbook: number }; variable: Record<string, number> };
  stages: string[][]; question: { question: string; options: { label: string; intent: string }[] } | null; policyVersion: string;
}
export interface PackItem {
  id: string; tier: 1 | 2 | 3 | 4; kind: string; source: { path?: string; range?: { startLine: number; endLine: number }; commit?: string; virtual?: string };
  why: { intent: string; rule: string; weight: number; score: number }; tokens: number; stage: number; content: string;
}
export interface Pack {
  packId: string; repo: string; commit?: string; route: { w: IntentVector; H: number; branch: string; stages: string[][]; question?: string };
  budget: number; tokensUsed: number; openLookups: { tool: string; args: Record<string, unknown>; reason: string }[]; items: PackItem[]; policyVersion: string; createdAt: string;
}
