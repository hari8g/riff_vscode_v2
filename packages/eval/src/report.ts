import type { Task } from './tasks.js';
import { compare, fileRecall, type Summary } from './metrics.js';
import type { TaskResult } from './runners/types.js';

/** Markdown and JSON reports for CI job summaries and docs/eval. */

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const num = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)}k` : x.toFixed(x < 10 ? 1 : 0));

export interface Report {
  generatedAt: string;
  summaries: Summary[];
  results: TaskResult[];
}

/** Renders a markdown report: summary table, comparison vs the first summary, per-task rows. */
export function renderMarkdown(report: Report, tasks: readonly Task[], title = 'RIAF eval'): string {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const lines: string[] = [`# ${title}`, '', `Generated ${report.generatedAt}.`, '', '| Runner | Tasks | File recall | Full recall | Precision | Mean tokens | Mean tool calls | Pass rate | Errors |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const s of report.summaries) {
    lines.push(`| ${s.runner} | ${s.tasks} | ${pct(s.recall)} | ${s.fullRecall}/${s.tasks} | ${pct(s.precision)} | ${num(s.meanTokens)} | ${s.meanToolCalls.toFixed(1)} | ${s.passRate !== undefined ? `${pct(s.passRate)} (${s.passCounted})` : '–'} | ${s.errors} |`);
  }
  if (report.summaries.length > 1) {
    const base = report.summaries[0]!;
    lines.push('', `Compared with **${base.runner}**:`, '');
    for (const s of report.summaries.slice(1)) {
      const c = compare(base, s);
      lines.push(`- ${s.runner}: recall ${c.recallDelta >= 0 ? '+' : ''}${(c.recallDelta * 100).toFixed(1)} pts, tokens ${pct(c.tokenReduction)} fewer, tool calls ${pct(c.toolCallReduction)} fewer${c.passRateDelta !== undefined ? `, pass rate ${c.passRateDelta >= 0 ? '+' : ''}${(c.passRateDelta * 100).toFixed(1)} pts` : ''}`);
    }
  }
  const branchy = report.summaries.filter((s) => Object.keys(s.branches).length);
  if (branchy.length) {
    lines.push('', '| Runner | Branch distribution | Clarification rate | Pack utilisation |', '| --- | --- | --- | --- |');
    for (const s of branchy) lines.push(`| ${s.runner} | ${Object.entries(s.branches).map(([k, v]) => `${k} ${v}`).join(', ')} | ${s.clarificationRate !== undefined ? pct(s.clarificationRate) : '–'} | ${s.meanUtilisation !== undefined ? pct(s.meanUtilisation) : '–'} |`);
  }
  lines.push('', '## Per task', '', '| Task | Intent | Runner | Recall | Tokens | Tool calls | Passed | Files |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of [...report.results].sort((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : a.runner < b.runner ? -1 : 1))) {
    const t = byId.get(r.taskId);
    lines.push(`| ${r.taskId} | ${r.intent} | ${r.runner} | ${t ? pct(fileRecall(t, r.files)) : '–'} | ${num(r.tokens)} | ${r.toolCalls} | ${r.passed === undefined ? (r.testsSkipped ? 'skipped' : '–') : r.passed ? 'yes' : 'no'} | ${r.files.slice(0, 4).join(', ')}${r.files.length > 4 ? ', …' : ''} |`);
  }
  return lines.join('\n') + '\n';
}
