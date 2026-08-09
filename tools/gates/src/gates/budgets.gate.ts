import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MEASURED_BUDGETS, SIZE_BUDGETS } from '../config.js';
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
