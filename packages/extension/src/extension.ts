import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { DaemonClient } from '@riaf/daemon/client';
import { bundledCli, connectDaemon } from './client.js';
import { handleConsole, type ConsoleRequest } from './consoleHost.js';
import { handleChat, handoffPrompt } from './participant.js';
import { invokeTool, TOOL_DEFS, type ToolName } from './tools.js';

/**
 * The extension is thin: a daemon client, a status bar, Copilot LM tools, the @riaf participant that
 * hands tasks to Copilot agent mode or Claude Code, and the console webview. All logic is in the
 * daemon; everything here is wiring.
 */

let client: DaemonClient | undefined;
let connecting: Promise<DaemonClient> | undefined;

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function rpc(context: vscode.ExtensionContext): Promise<DaemonClient> {
  if (client) return client;
  const root = workspaceRoot();
  if (!root) throw new Error('open a folder to use RIAF');
  connecting ??= connectDaemon(root, context.extensionPath).then((c) => (client = c)).finally(() => (connecting = undefined));
  return connecting;
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
  reg('riaf.init', async () => {
    const root = workspaceRoot();
    if (!root) return;
    const term = vscode.window.createTerminal({ name: 'RIAF init', cwd: root, env: { ELECTRON_RUN_AS_NODE: '1' } });
    term.show();
    term.sendText(`"${process.execPath}" "${bundledCli(context.extensionPath)}" init --host both --root "${root}"`);
  });
  reg('riaf.openConsole', () => openConsole(context));
}

function openConsole(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel('riaf.console', 'RIAF Console', vscode.ViewColumn.Active, {
    enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
  });
  const asset = (f: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview', f));
  const nonce = Math.random().toString(36).slice(2);
  panel.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${asset('console.css')}"></head><body><div id="root"></div><script nonce="${nonce}" src="${asset('console.js')}"></script></body></html>`;
  panel.webview.onDidReceiveMessage(async (msg: ConsoleRequest & { id: number }) => {
    try {
      const root = workspaceRoot();
      const res = await handleConsole({
        rpc: await rpc(context),
        writeRiafFile: async (name, text) => {
          if (!root) throw new Error('no workspace');
          await mkdir(join(root, '.riaf'), { recursive: true });
          await writeFile(join(root, '.riaf', name), text);
        },
        modelSettings: () => vscode.workspace.getConfiguration('riaf').get<Record<string, unknown>>('models') ?? {},
      }, msg);
      void panel.webview.postMessage({ id: msg.id, ...res });
    } catch (e) {
      void panel.webview.postMessage({ id: msg.id, type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  });
}

export async function deactivate(): Promise<void> {
  await client?.close();
  client = undefined;
}
