import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BROWSER_BASELINE_FILE,
  BROWSER_STUDY_WORKFLOW,
  FONT_BUDGET_LIMITS,
  FONT_BUDGETS,
  MEASURED_BUDGETS,
  SIZE_BUDGETS,
} from '../config.js';
import { checkCeilings, readBrowserBaseline, recordedFigure } from '../lib/browser-baseline.js';
import {
  evaluateBudget,
  formatBytes,
  gzipSizeOf,
  type ArtifactMeasurement,
} from '../lib/budgets.js';
import { collectFiles } from '../lib/walk.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * Checks the size budgets from SPEC 20 against built artifacts.
 *
 * A budget whose artifacts do not exist yet is reported as skipped, naming the task that
 * will produce them. A skip is printed on every run so that an unbuilt bundle can never
 * read as a passing budget.
 *
 * The three font budgets are per theme, per SPEC 20, and measured over the theme's own font
 * directory: what the first paint waits for, what a latin reader downloads across a session,
 * and what the package weighs. Gzip of a woff2 is a fraction of a percent larger than the file,
 * because woff2 is already brotli compressed and a server must not compress it again, so these
 * three effectively bound the raw bytes and do it in the unfavourable direction.
 */
export const budgetsGate: Gate = {
  id: 'budgets',
  title: 'Size budgets',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];
    let failed = false;
    let measured = 0;

    for (const budget of SIZE_BUDGETS) {
      const measurements: ArtifactMeasurement[] = [];

      for (const root of budget.roots) {
        for (const relativePath of collectFiles(
          join(context.repoRoot, root),
          budget.extensions,
          context.repoRoot,
        )) {
          const content = readFileSync(join(context.repoRoot, relativePath));
          measurements.push({
            path: relativePath,
            rawBytes: content.byteLength,
            gzipBytes: gzipSizeOf(content),
          });
        }
      }

      if (measurements.length === 0) {
        findings.push({
          level: 'info',
          message: `SKIP ${budget.id}: no artifacts under ${budget.roots.join(', ')} (produced by ${budget.producedBy})`,
        });
        continue;
      }

      measured += 1;
      const evaluation = evaluateBudget(budget.limitBytes, measurements);
      const summary = `${budget.id}: ${formatBytes(evaluation.totalGzipBytes)} of ${formatBytes(evaluation.limitBytes)} across ${String(measurements.length)} file(s)`;

      if (evaluation.ok) {
        findings.push({ level: 'info', message: `OK ${summary}` });
      } else {
        failed = true;
        findings.push({
          level: 'error',
          message: `OVER ${summary}, exceeded by ${formatBytes(evaluation.overBy)}`,
        });
      }
    }

    for (const budget of FONT_BUDGETS) {
      const files = collectFiles(
        join(context.repoRoot, budget.directory),
        ['.woff2', '.woff', '.ttf', '.otf'],
        context.repoRoot,
      );

      if (files.length === 0) {
        findings.push({
          level: 'info',
          message: `SKIP fonts, ${budget.theme}: no font files under ${budget.directory} (produced by ${budget.producedBy})`,
        });
        continue;
      }

      const measurements = files.map((relativePath) => {
        const content = readFileSync(join(context.repoRoot, relativePath));
        return {
          path: relativePath,
          rawBytes: content.byteLength,
          gzipBytes: gzipSizeOf(content),
        };
      });

      const named = (files: readonly string[]): ArtifactMeasurement[] => {
        const wanted = new Set(files);
        return measurements.filter((measurement) =>
          wanted.has(measurement.path.slice(measurement.path.lastIndexOf('/') + 1)),
        );
      };

      const firstPaint = named(budget.firstPaint);
      const latin = named(budget.latin);

      // A named file that is not there would otherwise measure as zero, which is the one way
      // either of these two budgets could pass by being wrong rather than by being small.
      const absent = [
        ['fonts-first-paint', budget.firstPaint, firstPaint],
        ['fonts-latin', budget.latin, latin],
      ] as const;

      const missing = absent.filter(([, wanted, found]) => found.length !== wanted.length);

      if (missing.length > 0) {
        failed = true;
        for (const [id, wanted, found] of missing) {
          findings.push({
            level: 'error',
            message: `${id}, ${budget.theme}: names ${String(wanted.length)} file(s) and found ${String(found.length)} under ${budget.directory}`,
          });
        }
        continue;
      }

      measured += 1;

      for (const [id, limit, group] of [
        ['fonts-first-paint', FONT_BUDGET_LIMITS.firstPaintBytes, firstPaint],
        ['fonts-latin', FONT_BUDGET_LIMITS.latinBytes, latin],
        ['fonts-total', FONT_BUDGET_LIMITS.totalBytes, measurements],
      ] as const) {
        const evaluation = evaluateBudget(limit, group);
        const summary = `${id}, ${budget.theme}: ${formatBytes(evaluation.totalGzipBytes)} of ${formatBytes(evaluation.limitBytes)} across ${String(group.length)} file(s)`;

        if (evaluation.ok) {
          findings.push({ level: 'info', message: `OK ${summary}` });
        } else {
          failed = true;
          findings.push({
            level: 'error',
            message: `OVER ${summary}, exceeded by ${formatBytes(evaluation.overBy)}`,
          });
        }
      }
    }

    // THE BROWSER BUDGETS ARE READ FROM THE RECORD, NOT MEASURED HERE. A CPU throttle is
    // relative to the host, so a figure taken on whichever machine runs `pnpm gates` would name
    // a machine nobody will run again. What is checked here is the committed study: that it is
    // there, that it is a study, and that what it recorded is inside SPEC 20. A missing or
    // unreadable record fails, per T001: nothing to read reads exactly like nothing to find.
    const baselineResult = readBrowserBaseline(context.repoRoot);

    if (baselineResult.baseline === null) {
      failed = true;
      findings.push({
        level: 'error',
        message: `${BROWSER_BASELINE_FILE}: ${baselineResult.reason ?? 'could not be read'}. The browser budgets of SPEC 20 have no measurement behind them until it is re-recorded by ${BROWSER_STUDY_WORKFLOW}`,
      });
    } else {
      const baseline = baselineResult.baseline;
      const overBudget = new Map(
        checkCeilings(baseline).map((issue) => [issue.budget, issue.message]),
      );

      findings.push({
        level: 'info',
        message:
          `browser figures recorded ${baseline.recordedAt} on ${baseline.environment.id}, ` +
          `${baseline.environment.cpuModel} x ${String(baseline.environment.cpuCount)}, ` +
          `Chrome ${String(baseline.browser.major)}, throttle ${String(baseline.throttleRate)}x measured ` +
          `${baseline.throttleRatio.median.toFixed(2)}x, commit ${baseline.commit.slice(0, 12)}`,
      });

      for (const budget of MEASURED_BUDGETS) {
        const recorded = recordedFigure(baseline, budget.id);
        const over = overBudget.get(budget.id);

        if (over !== undefined) {
          failed = true;
          findings.push({
            level: 'error',
            message: `OVER BUDGET ${budget.id}: ${budget.label} <= ${budget.limit}, measured ${over}`,
          });
          continue;
        }

        findings.push({
          level: 'info',
          message:
            recorded === null
              ? `NOT MEASURED HERE ${budget.id}: ${budget.label} <= ${budget.limit} (enforced by ${budget.enforcedBy})`
              : `MEASURED ${budget.id}: ${recorded} of ${budget.limit} (${budget.enforcedBy}, from ${BROWSER_BASELINE_FILE})`,
        });
      }
    }

    return Promise.resolve({
      id: budgetsGate.id,
      title: budgetsGate.title,
      status: failed ? 'fail' : measured === 0 ? 'skip' : 'pass',
      findings,
    });
  },
};
