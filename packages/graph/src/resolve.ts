import type { SymbolId, SymbolKind } from '@riaf/kernel';
import type { EdgeKind, RefRecord, Store, SymbolRecord } from '@riaf/store';

/**
 * Binds references to definitions. Scope-aware first (the enclosing class, then the file), then
 * through the file's resolved imports, then a global name match whose confidence falls with the
 * number of candidates. Everything runs against an in-memory symbol index built once per stage run.
 */

export interface SymbolLite {
  id: SymbolId;
  kind: SymbolKind;
  name: string;
  qualifiedName: string;
  path: string;
  parentId?: SymbolId;
}

const CALLABLE = new Set<SymbolKind>(['function', 'method', 'constructor', 'class', 'struct', 'variable', 'constant']);
const CONSTRUCTIBLE = new Set<SymbolKind>(['class', 'struct', 'constructor', 'type']);
const INHERITABLE = new Set<SymbolKind>(['class', 'interface', 'trait', 'struct', 'type']);
const TYPELIKE = new Set<SymbolKind>(['class', 'interface', 'type', 'enum', 'struct', 'trait']);

/** Which definition kinds a reference kind may bind to. */
export function compatible(refKind: string, kind: SymbolKind): boolean {
  switch (refKind) {
    case 'call': return CALLABLE.has(kind);
    case 'new': return CONSTRUCTIBLE.has(kind);
    case 'inherit': return INHERITABLE.has(kind);
    case 'type': return TYPELIKE.has(kind);
    default: return kind !== 'file' && kind !== 'test';
  }
}

/** Edge kind recorded for a resolved reference. */
export function edgeKindFor(refKind: string): EdgeKind {
  switch (refKind) {
    case 'call':
    case 'new': return 'invokes';
    case 'inherit': return 'inherits';
    case 'type': return 'defines_type';
    default: return 'references';
  }
}

export interface Binding {
  dst: SymbolId;
  confidence: number;
}

/** Names of types a scope (and its file) mentions: type annotations, `new X`, base classes. */
export interface TypeContext {
  scope: ReadonlySet<string>;
  file: ReadonlySet<string>;
}

const HEADER = /\.(h|hh|hpp|hxx)$/;

/**
 * Member names so common in standard libraries (Map.get, list.append, stream.write…) that a bare name
 * match is no evidence of a call into repository code. They still bind through scope, file, imports
 * and type context; only the global name fallback skips them.
 */
export const GENERIC_MEMBER_NAMES: ReadonlySet<string> = new Set([
  'get', 'set', 'has', 'add', 'delete', 'remove', 'clear', 'push', 'pop', 'shift', 'unshift', 'map', 'filter', 'reduce', 'forEach', 'find',
  'some', 'every', 'includes', 'indexOf', 'join', 'split', 'slice', 'splice', 'concat', 'sort', 'keys', 'values', 'entries', 'toString',
  'valueOf', 'replace', 'trim', 'then', 'catch', 'finally', 'append', 'extend', 'items', 'update', 'copy', 'write', 'read', 'close', 'open',
  'send', 'emit', 'on', 'off', 'once', 'format', 'parse', 'log', 'info', 'warn', 'error', 'debug', 'apply', 'call', 'bind', 'size', 'length',
  'next', 'equals', 'hashCode', 'compareTo', 'isEmpty', 'contains', 'put', 'stream', 'collect', 'of', 'orElse', 'orElseThrow', 'isPresent',
  'ifPresent', 'start', 'stop', 'run', 'init', 'free', 'malloc', 'printf', 'sprintf', 'strlen', 'memcpy', 'memset',
]);

/** In-memory index over every symbol and resolved import, rebuilt per graph stage run. */
export class SymbolIndex {
  readonly byId = new Map<SymbolId, SymbolLite>();
  readonly byName = new Map<string, SymbolLite[]>();
  readonly byPath = new Map<string, SymbolLite[]>();
  readonly importsOf = new Map<string, Set<string>>();

  static load(store: Store): SymbolIndex {
    const idx = new SymbolIndex();
    for (const s of store.symbols.all()) idx.add(s);
    for (const r of store.imports.all()) {
      if (!r.resolved) continue;
      const set = idx.importsOf.get(r.path) ?? new Set<string>();
      set.add(r.resolved);
      idx.importsOf.set(r.path, set);
    }
    return idx;
  }

  add(s: SymbolRecord | SymbolLite): void {
    const lite: SymbolLite = { id: s.id, kind: s.kind, name: s.name, qualifiedName: s.qualifiedName, path: s.path, ...(s.parentId ? { parentId: s.parentId } : {}) };
    this.byId.set(lite.id, lite);
    if (lite.kind !== 'file') {
      const n = this.byName.get(lite.name) ?? [];
      n.push(lite);
      this.byName.set(lite.name, n);
    }
    const p = this.byPath.get(lite.path) ?? [];
    p.push(lite);
    this.byPath.set(lite.path, p);
  }

  /** The chain of enclosing symbols of `id`, innermost first (excluding the file). */
  ancestors(id: SymbolId): SymbolLite[] {
    const out: SymbolLite[] = [];
    let cur = this.byId.get(id);
    while (cur?.parentId) {
      const p = this.byId.get(cur.parentId);
      if (!p || p.kind === 'file') break;
      out.push(p);
      cur = p;
    }
    return out;
  }

  /** Resolves one reference, then links C/C++ header prototypes to their implementations. */
  resolve(ref: RefRecord, ctx?: TypeContext): Binding[] {
    const out = this.resolveRaw(ref, ctx);
    const extra: Binding[] = [];
    for (const b of out) {
      const d = this.byId.get(b.dst);
      if (!d || d.kind !== 'function' || !HEADER.test(d.path)) continue;
      for (const impl of this.byName.get(d.name) ?? []) {
        if (impl.kind === 'function' && !HEADER.test(impl.path) && !out.some((o) => o.dst === impl.id)) extra.push({ dst: impl.id, confidence: Math.min(0.9, b.confidence) });
      }
    }
    return extra.length ? [...out, ...extra] : out;
  }

  /** Prefers member candidates whose owning type the scope (else the file) mentions. */
  private byTypeContext(list: SymbolLite[], ctx: TypeContext | undefined): SymbolLite[] {
    if (!ctx || list.length < 2) return list;
    const owner = (c: SymbolLite) => (c.parentId ? this.byId.get(c.parentId)?.name : undefined);
    for (const names of [ctx.scope, ctx.file]) {
      const hit = list.filter((c) => {
        const o = owner(c);
        return o !== undefined && names.has(o);
      });
      if (hit.length) return hit;
    }
    return list;
  }

  private resolveRaw(ref: RefRecord, ctx?: TypeContext): Binding[] {
    const candidates = (this.byName.get(ref.name) ?? []).filter((c) => compatible(ref.kind, c.kind) && c.id !== ref.scopeId);
    if (candidates.length === 0) return [];
    // 1. members of the enclosing containers (this.foo(), self.foo(), sibling methods)
    const chain = this.ancestors(ref.scopeId).map((a) => a.id);
    const scopeSelf = this.byId.get(ref.scopeId);
    if (scopeSelf && scopeSelf.kind !== 'file' && scopeSelf.kind !== 'function' && scopeSelf.kind !== 'method' && scopeSelf.kind !== 'test') chain.unshift(scopeSelf.id);
    for (const container of chain) {
      const hit = candidates.filter((c) => c.parentId === container);
      if (hit.length) return hit.map((c) => ({ dst: c.id, confidence: 0.95 }));
    }
    // 2. same file
    const same = candidates.filter((c) => c.path === ref.path);
    if (same.length) return pickTop(same, 0.9);
    // 3. through resolved imports (and one hop of re-exports)
    const imported = this.importsOf.get(ref.path);
    if (imported) {
      const direct = this.byTypeContext(candidates.filter((c) => imported.has(c.path)), ctx);
      if (direct.length) return pickTop(direct, 0.95);
      const second = new Set<string>();
      for (const f of imported) for (const g of this.importsOf.get(f) ?? []) second.add(g);
      const via = this.byTypeContext(candidates.filter((c) => second.has(c.path)), ctx);
      if (via.length) return pickTop(via, 0.8);
    }
    // 3b. the owning type is mentioned in this scope or file (receiver typed by a local or field)
    const typed = this.byTypeContext(candidates, ctx);
    if (typed.length < candidates.length) return pickTop(typed, 0.85);
    // 3c. same package / directory (Java, Go and C# need no import inside a package)
    const dir0 = ref.path.slice(0, ref.path.lastIndexOf('/'));
    const samePkg = candidates.filter((c) => c.path.slice(0, c.path.lastIndexOf('/')) === dir0);
    if (samePkg.length) return pickTop(samePkg, samePkg.length === 1 ? 0.85 : 0.6);
    // 4. global name match; prefer top-level definitions, confidence decays with ambiguity
    if (GENERIC_MEMBER_NAMES.has(ref.name)) return [];
    const top = candidates.filter((c) => !c.parentId || this.byId.get(c.parentId)?.kind === 'file');
    const pool = ref.kind === 'call' && top.length ? top : candidates;
    if (pool.length === 1) return [{ dst: pool[0]!.id, confidence: 0.7 }];
    // same directory tree wins ties for ambiguous names
    const dir = ref.path.slice(0, ref.path.lastIndexOf('/'));
    const near = pool.filter((c) => c.path.startsWith(dir + '/'));
    const chosen = (near.length ? near : pool).slice(0, 5);
    return chosen.map((c) => ({ dst: c.id, confidence: Math.max(0.1, 0.6 / chosen.length) }));
  }
}

function pickTop(list: SymbolLite[], confidence: number): Binding[] {
  // Prefer a class over its constructor for `new X`, and the shallowest definition otherwise.
  const sorted = [...list].sort((a, b) => a.qualifiedName.split('.').length - b.qualifiedName.split('.').length);
  const best = sorted.filter((s) => s.qualifiedName.split('.').length === sorted[0]!.qualifiedName.split('.').length);
  return best.slice(0, 3).map((c) => ({ dst: c.id, confidence: best.length === 1 ? confidence : confidence / best.length }));
}
