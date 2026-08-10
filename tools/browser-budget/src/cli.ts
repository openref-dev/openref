/**
 * `node tools/browser-budget/dist/cli.js [--tti-runs=N] [--memory-runs=N] [--out=FILE]`
 *
 * Runs the study and prints it. This is what CI runs to produce the spread a baseline is set
 * from, and it prints a readable summary as well as the JSON, because the summary is what a
 * maintainer reads in a workflow log and the JSON is what gets committed.
 */

import { writeFileSync } from 'node:fs';
import { runStudy } from './study.js';
import type { StudyReport } from './study.js';

/**
 * Formats the human readable half.
 *
 * @param report - What the study produced
 * @returns Lines to print
 */
export function summarize(report: StudyReport): string[] {
  const kb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  return [
    '=== browser budget study ===',
    `environment    ${report.environment.id}`,
    `               ${report.environment.label}`,
    `cpu            ${report.environment.cpuModel} x ${String(report.environment.cpuCount)}`,
    `chrome         ${report.browser.version} (major ${String(report.browser.major)})`,
    `chrome args    ${report.chromeArgs.join(' ')}`,
    `throttle       ${String(report.throttleRate)}x requested, measured ${report.throttleRatios
      .map((ratio) => ratio.toFixed(2))
      .join(', ')}`,
    '',
    `tti            ${String(report.tti.count)} runs, median ${report.tti.median.toFixed(1)} ms, ` +
      `min ${report.tti.min.toFixed(1)}, max ${report.tti.max.toFixed(1)}, ` +
      `sd ${report.tti.standardDeviation.toFixed(1)}, ` +
      `range ${(report.tti.relativeRange * 100).toFixed(1)}% of median`,
    `               samples ${report.tti.samples.map((value) => value.toFixed(1)).join(', ')}`,
    `peak heap      ${String(report.peakHeapBytes.count)} runs, median ${kb(report.peakHeapBytes.median)}, ` +
      `min ${kb(report.peakHeapBytes.min)}, max ${kb(report.peakHeapBytes.max)}`,
    `external reqs  ${String(report.externalRequests.length)}`,
    ...report.externalRequests.map((request) => `               ${request}`),
    `csp violations ${String(report.cspViolations.length)}`,
    ...report.cspViolations.map((violation) => `               ${violation}`),
  ];
}

const args = process.argv.slice(2);
const value = (name: string): string | undefined =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];

const ttiRunsArg = value('tti-runs');
const memoryRunsArg = value('memory-runs');

const report = await runStudy({
  ...(ttiRunsArg === undefined ? {} : { ttiRuns: Number(ttiRunsArg) }),
  ...(memoryRunsArg === undefined ? {} : { memoryRuns: Number(memoryRunsArg) }),
});

for (const line of summarize(report)) process.stdout.write(`${line}\n`);

const out = value('out');
if (out !== undefined) {
  // The per run detail is dropped from the file on purpose: what a baseline is set from is the
  // spread and the identity, and a committed file full of individual navigations would churn
  // on every run while saying nothing more.
  const { ttiRuns: _tti, memoryRuns: _memory, ...record } = report;
  writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  process.stdout.write(`\nwritten to ${out}\n`);
}
