/** LspPort — optional precise symbol information from a language server (Serena-style enrichment). */

export interface SourcePosition {
  line: number; // 0-based
  character: number; // 0-based, UTF-16 units as in LSP
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

export interface Location {
  path: string; // repo-relative, forward slashes
  range: SourceRange;
}

export interface DocumentSymbol {
  name: string;
  kind: string; // LSP SymbolKind name, lower-cased
  range: SourceRange;
  selectionRange: SourceRange;
  children?: DocumentSymbol[];
}

export interface LspPort {
  readonly languageId: string;
  isAvailable(): Promise<boolean>;
  definition(loc: Location): Promise<Location[]>;
  references(loc: Location, includeDeclaration?: boolean): Promise<Location[]>;
  documentSymbols(path: string): Promise<DocumentSymbol[]>;
  hover(loc: Location): Promise<string | undefined>;
  dispose(): Promise<void>;
}
