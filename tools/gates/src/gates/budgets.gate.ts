import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FONT_BUDGET_LIMITS, FONT_BUDGETS, MEASURED_BUDGETS, SIZE_BUDGETS } from '../config.js';
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
 * The two font budgets are per theme, per SPEC 20, and measured over the theme's own font
 * directory. Gzip of a woff2 is a fraction of a percent larger than the file, because woff2 is
 * already brotli compressed and a server must not compress it again, so these two effectively
 * bound the raw bytes and do it in the unfavourable direction.
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

      const wanted = new Set(budget.firstPaint);
      const firstPaint = measurements.filter((measurement) =>
        wanted.has(measurement.path.slice(measurement.path.lastIndexOf('/') + 1)),
      );

      // A named first paint file that is not there would otherwise measure as zero, which is
      // the one way this budget could pass by being wrong rather than by being small.
      if (firstPaint.length !== budget.firstPaint.length) {
        failed = true;
        findings.push({
          level: 'error',
          message: `fonts-first-paint, ${budget.theme}: names ${String(budget.firstPaint.length)} file(s) and found ${String(firstPaint.length)} under ${budget.directory}`,
        });
        continue;
      }

      measured += 1;

      for (const [id, limit, group] of [
        ['fonts-first-paint', FONT_BUDGET_LIMITS.firstPaintBytes, firstPaint],
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

    for (const budget of MEASURED_BUDGETS) {
      findings.push({
        level: 'info',
        message: `NOT MEASURED HERE ${budget.id}: ${budget.label} <= ${budget.limit} (enforced by ${budget.enforcedBy})`,
      });
    }

    return Promise.resolve({
      id: budgetsGate.id,
      title: budgetsGate.title,
      status: failed ? 'fail' : measured === 0 ? 'skip' : 'pass',
      findings,
    });
  },
};
