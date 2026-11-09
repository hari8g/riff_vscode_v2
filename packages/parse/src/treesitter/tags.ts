import type { SymbolKind } from '@riaf/kernel';
import { isTestPath, type LanguageId } from '../languages.js';
import { loadLanguage, nodeHasError, parseSource, type TsNode, type TsQuery, type TsTree } from './loader.js';
import { TAGS_QUERIES } from './queries.js';

/** A definition found in a file. Lines are 1-based and inclusive, as everywhere in RIAF. */
export interface DefTag {
  kind: SymbolKind;
  name: string;
  /** Dotted path of enclosing definitions plus the name, e.g. `TollSession.close`. */
  qualifiedName: string;
  /** Qualified name of the enclosing definition, when nested. */
  parent?: string;
  startLine: number;
  endLine: number;
  startIndex: number;
  endIndex: number;
  /** Declaration text up to the body, whitespace-collapsed. */
  signature: string;
  doc?: string;
}

export const REF_KINDS = ['call', 'type', 'inherit', 'new'] as const;
export type RefKind = (typeof REF_KINDS)[number];

/** A reference to a name; resolution to a definition happens in @riaf/graph. */
export interface RefTag {
  kind: RefKind;
  name: string;
  line: number;
  /** Qualified name of the innermost definition containing the reference (undefined at file scope). */
  scope?: string;
}

export interface ImportTag {
  /** The specifier as written, without quotes or angle brackets. */
  spec: string;
  line: number;
  /** True for `#include <...>` style system imports. */
  system?: boolean;
}

export interface FileTags {
  defs: DefTag[];
  refs: RefTag[];
  imports: ImportTag[];
  /** True when tree-sitter reported syntax errors; tags are still best effort. */
  hasErrors: boolean;
}

const CONTAINERS = new Set<SymbolKind>(['class', 'interface', 'struct', 'enum', 'trait', 'namespace', 'module']);
const queries = new Map<LanguageId, Promise<TsQuery>>();

async function tagsQuery(lang: LanguageId): Promise<TsQuery> {
  let q = queries.get(lang);
  if (!q) {
    q = loadLanguage(lang).then((l) => l.query(TAGS_QUERIES[lang]));
    queries.set(lang, q);
  }
  return q;
}

/** Strips quotes, angle brackets and template markers from a specifier or test-name literal. */
export function unquote(text: string): string {
  const t = text.trim();
  if (t.length >= 2) {
    const a = t[0];
    const b = t[t.length - 1];
    if ((a === '"' || a === "'" || a === '`') && a === b) return t.slice(1, -1);
    if (a === '<' && b === '>') return t.slice(1, -1);
  }
  return t;
}

const sanitizeName = (n: string): string => n.replace(/[#@\n\r]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);

/** The node whose range a definition should report: includes `export`, decorators and templates. */
function outerNode(node: TsNode): TsNode {
  let n = node;
  while (n.parent && ['export_statement', 'decorated_definition', 'template_declaration'].includes(n.parent.type)) n = n.parent;
  return n;
}

function signatureOf(def: TsNode, outer: TsNode, source: string): string {
  let body = def.childForFieldName('body');
  if (!body && (def.type === 'lexical_declaration' || def.type === 'variable_declaration')) {
    const value = def.namedChildren.find((c) => c.type === 'variable_declarator')?.childForFieldName('value');
    body = value?.childForFieldName('body') ?? null;
    if (value && !body) body = value;
  }
  const end = body && body.startIndex > outer.startIndex ? body.startIndex : Math.min(outer.endIndex, source.indexOf('\n', outer.startIndex) >>> 0);
  const text = source.slice(outer.startIndex, end > outer.startIndex ? end : outer.endIndex);
  const collapsed = text.replace(/\s+/g, ' ').replace(/\s*[{:=]\s*$/, '').trim();
  return collapsed.length > 240 ? `${collapsed.slice(0, 237)}...` : collapsed;
}

function cleanComment(text: string): string {
  return text
    .replace(/^\/\*\*?|\*\/$/g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*(\/\/\/?|#|\*)\s?/, '').trimEnd())
    .join('\n')
    .trim();
}

function docOf(outer: TsNode, def: TsNode, lang: LanguageId): string | undefined {
  if (lang === 'python') {
    const body = def.childForFieldName('body');
    const first = body?.namedChildren[0];
    if (first?.type === 'expression_statement' && first.namedChildren[0]?.type === 'string') {
      const s = first.namedChildren[0].text.replace(/^[rubf]*("""|'''|"|')/i, '').replace(/("""|'''|"|')$/, '');
      return s.trim().slice(0, 600) || undefined;
    }
  }
  const parts: string[] = [];
  let prev = outer.previousNamedSibling;
  let expectRow = outer.startPosition.row;
  while (prev && prev.type === 'comment' && prev.endPosition.row >= expectRow - 1) {
    parts.unshift(cleanComment(prev.text));
    expectRow = prev.startPosition.row;
    prev = prev.previousNamedSibling;
  }
  const doc = parts.join('\n').trim();
  return doc ? doc.slice(0, 600) : undefined;
}

function isAnnotatedTest(def: TsNode): boolean {
  const mods = def.namedChildren.find((c) => c.type === 'modifiers' || c.type === 'attribute_list');
  const text = mods?.text ?? '';
  return /@(Test|ParameterizedTest|RepeatedTest)\b|\[(Test|Fact|Theory|TestMethod)\b/.test(text) ||
    (def.previousNamedSibling?.type === 'attribute_list' && /\[(Test|Fact|Theory|TestMethod)\b/.test(def.previousNamedSibling.text));
}

function goReceiver(def: TsNode): string | undefined {
  const recv = def.childForFieldName('receiver');
  if (!recv) return undefined;
  const m = /([A-Za-z_]\w*)\s*(\[[^\]]*\])?\s*\)\s*$/.exec(recv.text);
  return m?.[1];
}

/** Extracts definitions, references and imports from one file. */
export async function extractTags(lang: LanguageId, path: string, source: string, tree?: TsTree): Promise<FileTags> {
  const own = !tree;
  const t = tree ?? (await parseSource(lang, source));
  try {
    const query = await tagsQuery(lang);
    const raw: { node: TsNode; outer: TsNode; kind: SymbolKind; name: string }[] = [];
    const refs: { kind: RefKind; name: string; line: number; index: number }[] = [];
    const imports: ImportTag[] = [];
    for (const m of query.matches(t.rootNode)) {
      const def = m.captures.find((c) => c.name.startsWith('def.'));
      if (def) {
        const nameNode = m.captures.find((c) => c.name === 'name')?.node;
        if (!nameNode) continue;
        const kind = def.name.slice(4) as SymbolKind;
        const name = sanitizeName(kind === 'test' ? unquote(nameNode.text) : nameNode.text);
        if (!name) continue;
        raw.push({ node: def.node, outer: outerNode(def.node), kind, name });
        continue;
      }
      for (const c of m.captures) {
        if (c.name.startsWith('ref.')) {
          refs.push({ kind: c.name.slice(4) as RefKind, name: c.node.text, line: c.node.startPosition.row + 1, index: c.node.startIndex });
        } else if (c.name === 'import') {
          const text = c.node.text;
          imports.push({ spec: unquote(text), line: c.node.startPosition.row + 1, ...(text.startsWith('<') ? { system: true } : {}) });
        }
      }
    }

    // Deduplicate (several patterns can match one node) and order by position for scoping.
    const seen = new Set<string>();
    const uniq = raw.filter((r) => {
      const k = `${r.node.startIndex}:${r.node.endIndex}:${r.name}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).sort((a, b) => a.outer.startIndex - b.outer.startIndex || b.outer.endIndex - a.outer.endIndex);

    const testFile = isTestPath(path);
    const defs: DefTag[] = [];
    const stack: DefTag[] = [];
    const used = new Map<string, number>();
    for (const r of uniq) {
      while (stack.length && stack[stack.length - 1]!.endIndex < r.outer.endIndex) stack.pop();
      const parent = stack[stack.length - 1];
      let kind = r.kind;
      if (kind === 'function' && parent && CONTAINERS.has(parent.kind)) kind = 'method';
      if ((kind === 'function' || kind === 'method') && (
        (lang === 'python' && r.name.startsWith('test_') && testFile) ||
        (lang === 'go' && /^Test[A-Z_]/.test(r.name) && path.endsWith('_test.go')) ||
        ((lang === 'java' || lang === 'csharp') && isAnnotatedTest(r.node))
      )) kind = 'test';
      let prefix = parent?.qualifiedName;
      if (lang === 'go' && r.kind === 'method' && r.node.type === 'method_declaration') prefix = goReceiver(r.node) ?? prefix;
      let qualifiedName = prefix ? `${prefix}.${r.name}` : r.name;
      if (kind === 'test' && parent?.kind === 'test') qualifiedName = `${parent.qualifiedName} > ${r.name}`;
      const key = `${qualifiedName}@${kind}`;
      const n = (used.get(key) ?? 0) + 1;
      used.set(key, n);
      if (n > 1) qualifiedName = `${qualifiedName}~${n}`;
      const doc = docOf(r.outer, r.node, lang);
      const tag: DefTag = {
        kind,
        name: r.name,
        qualifiedName,
        ...(parent ? { parent: parent.qualifiedName } : {}),
        startLine: r.outer.startPosition.row + 1,
        endLine: r.outer.endPosition.row + 1,
        startIndex: r.outer.startIndex,
        endIndex: r.outer.endIndex,
        signature: signatureOf(r.node, r.outer, source),
        ...(doc ? { doc } : {}),
      };
      defs.push(tag);
      stack.push(tag);
    }

    // Scope each reference to the innermost definition containing it; drop self-references at the name.
    const defNameAt = new Set(uniq.map((r) => r.node.childForFieldName('name')?.startIndex).filter((x): x is number => x !== undefined));
    const outRefs: RefTag[] = [];
    const refSeen = new Set<string>();
    for (const r of refs.sort((a, b) => a.index - b.index)) {
      if (defNameAt.has(r.index)) continue;
      let scope: DefTag | undefined;
      for (const d of defs) {
        if (d.startIndex <= r.index && r.index < d.endIndex && (!scope || d.startIndex >= scope.startIndex)) scope = d;
      }
      const k = `${r.kind}:${r.name}:${r.line}:${scope?.qualifiedName ?? ''}`;
      if (refSeen.has(k)) continue;
      refSeen.add(k);
      outRefs.push({ kind: r.kind, name: r.name, line: r.line, ...(scope ? { scope: scope.qualifiedName } : {}) });
    }
    return { defs, refs: outRefs, imports, hasErrors: nodeHasError(t.rootNode) };
  } finally {
    if (own) t.delete();
  }
}
