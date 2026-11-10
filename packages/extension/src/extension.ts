import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { DaemonClient } from '@riaf/daemon/client';
import { ClaudeLive } from './claudeLive.js';
import { bundledCli, connectDaemon } from './client.js';
import { handleConsole, type ConsoleRequest, type RepoHost } from './consoleHost.js';
import { handleChat, handoffPrompt } from './participant.js';
import { resolveClaude, shellCommand, vscodeTerminal, type LaunchResult, type LaunchSpec } from './terminal.js';
import { linkRuns, statusOf } from './runs.js';
import { sidebarItems, type SidebarItem } from './sidebar.js';
import { invokeTool, TOOL_DEFS, type ToolName } from './tools.js';

/**
 * The extension is thin: a daemon client, a status bar, Copilot LM tools, the @riaf participant that
 * hands tasks to Copilot agent mode or Claude Code, and the console webview. All logic is in the
 * daemon; everything here is wiring.
 */

let client: DaemonClient | undefined;
let connecting: Promise<DaemonClient> | undefined;
/** The repository RIAF works on: the one picked in the console, else the first workspace folder. */
let activeRoot: string | undefined;
let live: ClaudeLive | undefined;
let panel: vscode.WebviewPanel | undefined;
const RECENT_KEY = 'riaf.recentRepos';
let refreshStatus: (() => Promise<void>) | undefined;

function workspaceRoot(): string | undefined {
  return activeRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function rpc(context: vscode.ExtensionContext, fresh = false): Promise<DaemonClient> {
  if (client && !fresh) return client;
  const root = workspaceRoot();
  if (!root) throw new Error('open a repository folder to use RIAF');
  if (fresh) {
    await connecting?.catch(() => undefined);
    const old = client;
    client = undefined;
    await old?.close().catch(() => undefined);
    connecting = undefined;
  }
  connecting ??= connectDaemon(root, context.extensionPath, fresh).then((c) => (client = c)).finally(() => (connecting = undefined));
  return connecting;
}

/** An Rpc that connects on first use, so console requests that need no daemon never wait for one. */
const lazyRpc = (context: vscode.ExtensionContext) => ({ call: (async (m: never, p: never) => (await rpc(context)).call(m, p)) as DaemonClient['call'] });

/** Tails Claude Code's transcripts for the active repository and forwards new events to the console. */
function followClaude(): void {
  const root = workspaceRoot();
  if (live?.root === root) return;
  live?.stop();
  live = root ? new ClaudeLive(root) : undefined;
  if (!live) return;
  live.on((events) => void panel?.webview.postMessage({ type: 'push', channel: 'live', events }));
  live.on(() => refreshTree?.());
  live.start();
}

function relActive(): string | undefined {
  const doc = vscode.window.activeTextEditor?.document;
  const root = workspaceRoot();
  if (!doc || !root || !doc.uri.fsPath.startsWith(root)) return undefined;
  return doc.uri.fsPath.slice(root.length + 1).replace(/\\/g, '/');
}

const budget = () => vscode.workspace.getConfiguration('riaf').get<number>('budget') ?? 16000;

async function writePackFile(root: string, packId: string, rendered: string): Promise<string> {
  const dir = join(root, '.riaf', 'handoff');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${packId}.md`);
  await writeFile(file, rendered);
  return file;
}

/**
 * Opens a VS Code terminal whose own process is Claude Code, started in the repository on the launch file.
 * Nothing is typed into a terminal: typing lands in whatever runs there (an open Claude Code session got
 * the shell command as its task).
 */
function startClaude(spec: LaunchSpec): LaunchResult {
  const term = vscode.window.createTerminal(vscodeTerminal(spec, resolveClaude()));
  term.show();
  return { launched: true, how: 'a VS Code terminal', command: shellCommand(spec) };
}

let refreshTree: (() => void) | undefined;

/** The sidebar tree (Activity Bar → RIAF): actions and prompt runs, built by `sidebarItems`. */
class RiafTree implements vscode.TreeDataProvider<SidebarItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private pending: NodeJS.Timeout | undefined;
  /** Coalesces bursts (a Claude Code session writes many events) into one redraw. */
  refresh = (): void => {
    if (this.pending) return;
    this.pending = setTimeout(() => { this.pending = undefined; this.changed.fire(); }, 800);
  };
  getTreeItem(item: SidebarItem): vscode.TreeItem {
    const t = new vscode.TreeItem(item.label, item.children ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    t.id = item.id;
    t.iconPath = new vscode.ThemeIcon(item.icon);
    if (item.description) t.description = item.description;
    if (item.tooltip) t.tooltip = item.tooltip;
    if (item.open) t.command = { command: 'riaf.open', title: item.label, arguments: [item.open.page, item.open.arg] };
    else if (item.command) t.command = { command: item.command, title: item.label };
    return t;
  }
  getChildren(item?: SidebarItem): SidebarItem[] {
    if (item) return item.children ?? [];
    const root = workspaceRoot();
    const snap = live?.snapshot();
    const prompts = (id: string) => (live?.sessionEvents(id) ?? []).filter((e) => e.kind === 'prompt').map((e) => e.text);
    return sidebarItems(root, (r) => {
      const links = snap ? linkRuns([r], snap.sessions, prompts) : new Map();
      return statusOf(r, links.get(r.promptId));
    });
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'riaf.openConsole';
  status.text = '$(database) RIAF';
  status.show();
  context.subscriptions.push(status);
  const refresh = async () => {
    try {
      const s = await (await rpc(context)).call('index.status', {});
      const pending = s.stages.reduce((a, x) => a + x.pending, 0);
      status.text = pending ? `$(sync~spin) RIAF ${pending} pending` : `$(database) RIAF ${s.blobs} files`;
      status.tooltip = `${s.symbols} symbols · ${s.edges} edges · schema ${s.schemaVersion}${s.head ? ` · ${s.head.slice(0, 8)}` : ''}`;
    } catch (e) {
      status.text = '$(warning) RIAF';
      status.tooltip = e instanceof Error ? e.message : String(e);
    }
  };
  const timer = setInterval(() => void refresh(), 10_000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  void refresh();

  // Copilot LM tools
  for (const def of TOOL_DEFS) {
    context.subscriptions.push(vscode.lm.registerTool(def.name, {
      invoke: async (options) => {
        const text = await invokeTool(await rpc(context), def.name as ToolName, options.input as Record<string, unknown>, `vscode-${vscode.env.sessionId}`);
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
      },
    }));
  }

  // @riaf chat participant
  const participant = vscode.chat.createChatParticipant('riaf.participant', async (request, _ctx, stream) => {
    try {
      const r = await handleChat(await rpc(context), request.prompt, stream, { ...(relActive() ? { activeFile: relActive()! } : {}), sessionId: `vscode-${vscode.env.sessionId}`, budget: budget() });
      return { metadata: r };
    } catch (e) {
      stream.markdown(`RIAF could not compile a pack: ${e instanceof Error ? e.message : String(e)}`);
      return {};
    }
  });
  participant.iconPath = new vscode.ThemeIcon('database');
  context.subscriptions.push(participant);

  // commands
  const reg = (id: string, fn: (...args: never[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg('riaf.index', async () => {
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'RIAF: indexing' }, async () => (await rpc(context)).call('index.rebuild', { wait: true }));
    vscode.window.showInformationMessage(`RIAF indexed in ${Math.round(r.run?.ms ?? 0)} ms`);
    void refresh();
  });
  reg('riaf.pack', async () => {
    const text = await vscode.window.showInputBox({ prompt: 'What is the task?' });
    if (!text) return;
    const r = await (await rpc(context)).call('pack.compile', { request: { text, ide: { ...(relActive() ? { activeFile: relActive()! } : {}), interactive: true } }, target: 'claude', budget: budget() });
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: r.rendered });
    await vscode.window.showTextDocument(doc, { preview: true });
  });
  reg('riaf.jump', async () => {
    const sel = vscode.window.activeTextEditor;
    const word = sel ? sel.document.getText(sel.document.getWordRangeAtPosition(sel.selection.active)) : undefined;
    const query = await vscode.window.showInputBox({ prompt: 'Symbol (Class.method, name or path:line)', value: word ?? '' });
    if (!query) return;
    const j = await (await rpc(context)).call('graph.jump', { query });
    const root = workspaceRoot();
    if (!j.definition || !root) return void vscode.window.showWarningMessage(`RIAF: no symbol matched ${query}`);
    const d = j.definition;
    await vscode.window.showTextDocument(vscode.Uri.file(join(root, d.path)), { selection: new vscode.Range(d.startLine - 1, 0, d.startLine - 1, 0) });
  });
  reg('riaf.handoffCopilot', async (task: string, packId: string) => {
    const root = workspaceRoot();
    const r = await (await rpc(context)).call('pack.get', { packId, target: 'claude' });
    const file = root && r.rendered ? await writePackFile(root, packId, r.rendered) : undefined;
    await vscode.commands.executeCommand('workbench.action.chat.open', { query: file ? handoffPrompt(task, vscode.workspace.asRelativePath(file)) : task, mode: 'agent' });
  });
  reg('riaf.handoffClaude', async (task: string, packId: string) => {
    const root = workspaceRoot();
    if (!root) return;
    const r = await (await rpc(context)).call('pack.get', { packId, target: 'claude' });
    const file = r.rendered ? await writePackFile(root, packId, r.rendered) : undefined;
    const term = vscode.window.createTerminal({ name: 'Claude Code (RIAF)', cwd: root });
    term.show();
    term.sendText(`claude ${JSON.stringify(file ? handoffPrompt(task, vscode.workspace.asRelativePath(file)) : task)}`);
  });
  /** Starts Claude Code in a terminal with an exported RIAF prompt (the console's "Export to Claude Code"). */
  reg('riaf.runClaude', async (spec: LaunchSpec) => {
    const root = workspaceRoot();
    if (root && spec && spec.root === root && /^pr_\w+$/.test(spec.promptId) && typeof spec.file === 'string') startClaude(spec);
  });
  reg('riaf.init', async () => {
    const root = workspaceRoot();
    if (!root) return;
    const term = vscode.window.createTerminal({ name: 'RIAF init', cwd: root, env: { ELECTRON_RUN_AS_NODE: '1' } });
    term.show();
    term.sendText(`"${process.execPath}" "${bundledCli(context.extensionPath)}" init --host both --root "${root}"`);
  });
  reg('riaf.openConsole', () => openConsole(context));
  reg('riaf.open', (page: string, arg?: string) => openConsole(context, { page: typeof page === 'string' ? page : 'overview', ...(typeof arg === 'string' ? { arg } : {}) }));

  // Activity Bar → RIAF: quick actions and the latest prompt runs, with their live status
  const tree = new RiafTree();
  context.subscriptions.push(vscode.window.registerTreeDataProvider('riaf.home', tree));
  refreshTree = tree.refresh;
  const watcher = vscode.workspace.createFileSystemWatcher('**/.riaf/prompts/index.jsonl');
  watcher.onDidChange(tree.refresh); watcher.onDidCreate(tree.refresh);
  context.subscriptions.push(watcher);
  if (workspaceRoot()) followClaude();
  reg('riaf.openRepository', async () => {
    const root = await browseRepo();
    if (root) await switchRepo(context, root);
  });
  context.subscriptions.push({ dispose: () => live?.stop() });
  refreshStatus = refresh;
}


async function browseRepo(): Promise<string | undefined> {
  const pick = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Use this repository', title: 'RIAF: choose a repository folder' });
  return pick?.[0]?.fsPath;
}

/** Makes `root` the active repository: remembers it, restarts its daemon and Claude Code feed, redraws the console. */
async function switchRepo(context: vscode.ExtensionContext, root: string): Promise<void> {
  activeRoot = root;
  const recent = [root, ...(context.globalState.get<string[]>(RECENT_KEY) ?? []).filter((r) => r !== root)].slice(0, 8);
  await context.globalState.update(RECENT_KEY, recent);
  await rpc(context, true);
  followClaude();
  if (panel) renderConsole(context, panel);
  void refreshStatus?.();
  refreshTree?.();
}

/**
 * Opens the console. Every open starts clean: an earlier console panel is closed and the repository's
 * daemon is restarted, so nothing from an older build or an earlier session is still answering.
 */
function openConsole(context: vscode.ExtensionContext, nav?: { page: string; arg?: string }): void {
  // from the sidebar: an open console just jumps to the page; otherwise every open starts clean
  if (panel && nav) {
    panel.reveal();
    void panel.webview.postMessage({ type: 'push', channel: 'navigate', ...nav });
    return;
  }
  panel?.dispose();
  const p = vscode.window.createWebviewPanel('riaf.console', 'RIAF Console', vscode.ViewColumn.Active, {
    enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
  });
  panel = p;
  p.onDidDispose(() => { if (panel === p) panel = undefined; });
  renderConsole(context, p, nav);
  if (workspaceRoot()) void rpc(context, true).then(() => refreshStatus?.(), (e: Error) => vscode.window.showErrorMessage(`RIAF: could not start the daemon: ${e.message}`));
  followClaude();
  const repoHost: RepoHost = {
    current: () => workspaceRoot() ?? '',
    recent: () => context.globalState.get<string[]>(RECENT_KEY) ?? [],
    browse: browseRepo,
    open: (root) => switchRepo(context, root),
    reloadOnSwitch: false,
  };
  p.webview.onDidReceiveMessage(async (msg: ConsoleRequest & { id: number }) => {
    try {
      const root = workspaceRoot();
      const res = await handleConsole({
        rpc: lazyRpc(context),
        writeRiafFile: async (name, text) => {
          if (!root) throw new Error('no repository open');
          await mkdir(join(root, '.riaf'), { recursive: true });
          await writeFile(join(root, '.riaf', name), text);
        },
        modelSettings: () => vscode.workspace.getConfiguration('riaf').get<Record<string, unknown>>('models') ?? {},
        runCommand: async (command, ...args) => void (await vscode.commands.executeCommand(command, ...args)),
        launchClaude: async (spec) => startClaude(spec),
        repo: repoHost,
        live: () => live?.snapshot() ?? { dir: '', found: false, sessions: [], events: [] },
        liveSession: (id) => live?.sessionEvents(id) ?? [],
      }, msg);
      void p.webview.postMessage({ id: msg.id, ...res });
    } catch (e) {
      void p.webview.postMessage({ id: msg.id, type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  });
}

function renderConsole(context: vscode.ExtensionContext, p: vscode.WebviewPanel, nav?: { page: string; arg?: string }): void {
  const asset = (f: string) => p.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview', f));
  const nonce = Math.random().toString(36).slice(2);
  const root = workspaceRoot() ?? '';
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  p.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${p.webview.cspSource} data:; style-src ${p.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${asset('console.css')}"><title>RIAF Console</title></head><body data-repo="${root.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" data-mps="${asset('mps-logo.png')}" data-mark="${asset('riaf-mark.svg')}"${nav ? ` data-nav-page="${esc(nav.page)}"${nav.arg ? ` data-nav-arg="${esc(nav.arg)}"` : ''}` : ''}><div id="root"></div><script nonce="${nonce}" src="${asset('console.js')}"></script></body></html>`;
}

export async function deactivate(): Promise<void> {
  live?.stop();
  await client?.close();
  client = undefined;
}
