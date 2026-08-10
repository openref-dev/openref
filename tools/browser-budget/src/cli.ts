/**
 * `node tools/browser-budget/dist/cli.js [--tti-runs=N] [--memory-runs=N] [--out=FILE] [--check]`
 *
 * Runs the study and prints it. This is what CI runs to produce the spread a baseline is set
 * from, and it prints a readable summary as well as the JSON, because the summary is what a
 * maintainer reads in a workflow log and the JSON is what gets committed.
 *
 * WITH `--check` IT IS ALSO THE FAILING CHECK. A budget measured and not enforced is a report,
 * so the study compares what it just measured against `baseline.json`: the SPEC 20 ceilings
 * always, and the recorded figure when the machine and the browser major are the ones it was
 * recorded on. An image bump is reported as a stale baseline rather than as a regression, and
 * re-recording it is a deliberate act.
 */

import { writeFileSync } from 'node:fs';
import { checkCeilings, compareToBaseline, readBrowserBaseline } from '@openref/gates/baseline';
import { repositoryRoot } from './repo-root.js';
import { runStudy } from './study.js';
import type { Spread } from './statistics.js';
import type { StudyReport } from './study.js';

/**
 * Formats the human readable half.
 *
 * @param report - What the study produced
 * @returns Lines to print
 */
/**
 * The main thread block, one line per quantity, each with the spread beside the median.
 *
 * @param report - What the study produced
 * @returns Lines to print
 */
function workLines(report: StudyReport): string[] {
  const line = (label: string, spread: Spread, unit: string): string =>
    `               ${label.padEnd(18)} median ${spread.median.toFixed(unit === '' ? 2 : 1).padStart(8)}${unit}` +
    `  min ${spread.min.toFixed(unit === '' ? 2 : 1)}  max ${spread.max.toFixed(unit === '' ? 2 : 1)}` +
    `  sd ${spread.standardDeviation.toFixed(unit === '' ? 2 : 1)}` +
    `  range ${(spread.relativeRange * 100).toFixed(1)}% of median`;

  return [
    line('task time', report.work.taskMs, ' ms'),
    line('  script', report.work.scriptMs, ' ms'),
    line('  style recalc', report.work.recalcStyleMs, ' ms'),
    line('  layout', report.work.layoutMs, ' ms'),
    line('  other', report.work.otherMs, ' ms'),
    line('long tasks >50ms', report.work.longTaskCount, ''),
    line('  their total', report.work.longTaskTotalMs, ' ms'),
    line('calibrated work', report.work.calibratedWork, ''),
    `               samples ${report.work.taskMs.samples.map((value) => value.toFixed(1)).join(', ')}`,
    report.work.rendererReusedConsistently
      ? ''
      : '               THE RENDERER WAS REUSED ON SOME RUNS AND SWAPPED ON OTHERS, so the ' +
        'counters were read two different ways in one study',
  ].filter((text) => text !== '');
}

/**
 * One byte column, with min and max beside the median.
 *
 * These should not move at all between runs of one page, so the range is printed rather than
 * assumed away: a column that moved says the runs were not measuring the same thing.
 *
 * @param label - Which column
 * @param spread - What it did across the runs
 * @returns The line
 */
function byteLine(label: string, spread: Spread): string {
  const kb = (value: number): string => `${(value / 1024).toFixed(1)} KB`;

  return (
    `               ${label.padEnd(18)} median ${kb(spread.median).padStart(10)}` +
    `  min ${kb(spread.min)}  max ${kb(spread.max)}`
  );
}

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
    `               transfer ${report.ttiTransferMs.median.toFixed(1)} ms, ` +
      `parse ${report.ttiParseMs.median.toFixed(1)} ms, ` +
      `script and hydrate ${report.ttiScriptMs.median.toFixed(1)} ms, all medians`,
    `first paint    ${report.ttiFirstPaintMs.median.toFixed(1)} ms, median`,
    '',
    // PRINTED BESIDE TTI AND NOT INSTEAD OF IT. These are the quantities SPEC 20 moves to, and
    // the whole point of the study they feed is comparing their spread against the clock's on
    // one set of navigations. The relative range is what the comparison is read off, so it is
    // printed for every one of them rather than left to be worked out from min and max.
    'main thread    what the page cost, rather than how long it took',
    ...workLines(report),
    'parsed bytes   what the main thread is given, which no processor changes',
    byteLine('document', report.parsedBytes.documentBytes),
    byteLine('css', report.parsedBytes.cssBytes),
    byteLine('js', report.parsedBytes.jsBytes),
    byteLine('other', report.parsedBytes.otherBytes),
    'resources      when the last byte arrived, median, and what it was',
    ...report.ttiResources.map(
      (resource) =>
        `               ${resource.endMs.toFixed(1).padStart(8)} ms  ` +
        `${String(Math.round(resource.decodedBytes / 1024)).padStart(5)} KB  ` +
        `${resource.initiatorType.padEnd(6)} ${resource.path}`,
    ),
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

if (args.includes('--check')) {
  const { baseline, reason } = readBrowserBaseline(repositoryRoot());

  if (baseline === null) {
    process.stdout.write(`\nno baseline to check against: ${reason ?? 'unknown'}\n`);
    process.exitCode = 1;
  } else {
    const issues = [
      ...checkCeilings(baseline),
      ...compareToBaseline(baseline, {
        environmentId: report.environment.id,
        cpuModel: report.environment.cpuModel,
        browserMajor: report.browser.major,
        ttiMedianMs: report.tti.median,
        peakHeapMedianBytes: report.peakHeapBytes.median,
        externalRequests: report.externalRequests.length,
        cspViolations: report.cspViolations.length,
      }),
    ];

    process.stdout.write('\n=== against the committed baseline ===\n');
    for (const issue of issues) {
      process.stdout.write(`  [${issue.kind}] ${issue.budget}: ${issue.message}\n`);
    }

    if (issues.length === 0) process.stdout.write('  everything inside its budget\n');

    // A STALE BASELINE IS NOT A FAILURE OF THE PRODUCT. It says the two figures are not
    // comparable, which needs a person and not a red build.
    if (issues.some((issue) => issue.kind === 'over-budget')) process.exitCode = 1;
  }
}

const out = value('out');
if (out !== undefined) {
  // The per run detail is dropped from the file on purpose: what a baseline is set from is the
  // spread and the identity, and a committed file full of individual navigations would churn
  // on every run while saying nothing more.
  const { ttiRuns: _tti, memoryRuns: _memory, ...record } = report;
  writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  process.stdout.write(`\nwritten to ${out}\n`);
}
