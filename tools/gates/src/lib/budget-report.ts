/**
 * Every SPEC 20 budget measured once, as data rather than as printed lines.
 *
 * Two gates need this. The budgets gate prints it and decides whether the build stops; the
 * budget exceptions gate needs to know which budgets are actually over, because an entry
 * excusing a budget that is inside its limit is a debt already paid and reads as coverage.
 *
 * MEASURED ONCE, SHARED, RATHER THAN MEASURED TWICE. Two walks of the same artifacts with two
 * copies of the arithmetic is exactly how the two gates would come to disagree about whether a
 * budget is over, and the disagreement would surface as an exception that is stale on one gate
 * and live on the other.
 */

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
import { checkCeilings, readBrowserBaseline, recordedFigure } from './browser-baseline.js';
import {
  evaluateBudget,
  formatBytes,
  gzipSizeOf,
  type ArtifactMeasurement,
  type BudgetQuantity,
} from './budgets.js';
import { chunkName, partitionModuleGraph } from './module-graph.js';
import { collectFiles } from './walk.js';

/** How each quantity is printed, so a figure is never read as the other one. */
const QUANTITY_LABEL: Readonly<Record<BudgetQuantity, string>> = {
  transfer: 'gzip',
  parse: 'raw',
};

/**
 * What one budget came to on this run.
 *
 * `over` is the only status that stops a build. `skip` is an artifact that does not exist yet
 * and `not-measured` is a figure another harness owns; both are printed on every run so that
 * nothing unmeasured can read as something that passed.
 */
export type BudgetStatus = 'ok' | 'over' | 'skip' | 'not-measured';

/**
 * Where a budget's figure comes from, which decides how a gate labels it.
 *
 * `artifact` is weighed here from built files. `recorded` is read out of the committed browser
 * study, and its labels say so, because a reader has to be able to tell a number this run took
 * from a number this run merely repeated.
 */
export type BudgetSource = 'artifact' | 'recorded';

/** One budget and what happened to it. */
export interface BudgetOutcome {
  readonly id: string;
  readonly status: BudgetStatus;
  readonly source: BudgetSource;
  /** The line a gate prints, without a pass or fail prefix. */
  readonly message: string;
}

/** Everything one run of the budgets found. */
export interface BudgetReport {
  readonly outcomes: readonly BudgetOutcome[];
  /** Failures that belong to no single budget, such as an unreadable browser study. */
  readonly errors: readonly string[];
  /** Informational lines that are not about one budget, such as the study's environment. */
  readonly notes: readonly string[];
  /** How many budgets were actually measured, as opposed to skipped. */
  readonly measuredCount: number;
}

/**
 * Measures every SPEC 20 budget against the built artifacts and the committed browser study.
 *
 * @param repoRoot - Absolute repository root
 * @returns One outcome per budget, plus anything that is wrong with the measurement itself
 */
export function collectBudgetOutcomes(repoRoot: string): BudgetReport {
  const outcomes: BudgetOutcome[] = [];
  const errors: string[] = [];
  const notes: string[] = [];
  let measuredCount = 0;

  for (const budget of SIZE_BUDGETS) {
    const present: string[] = [];

    for (const root of budget.roots) {
      present.push(...collectFiles(join(repoRoot, root), budget.extensions, repoRoot));
    }

    // THE PARTITION IS COMPUTED BEFORE ANYTHING IS WEIGHED, so a budget over one side of a split
    // bundle weighs that side and not the directory holding it. A budget with no partition
    // weighs everything under its roots, which is what a set of files with no graph over them
    // means, and is how every budget behaved before the bundle was split.
    let wanted = present;

    if (budget.partition !== undefined && present.length > 0) {
      const partition = budget.partition;
      let split;
      try {
        split = partitionModuleGraph(repoRoot, partition.entry, present);
      } catch (cause) {
        errors.push(
          `${budget.id}: ${cause instanceof Error ? cause.message : String(cause)}. A bundle whose graph cannot be walked has no side to measure, and measuring the directory instead is what this partition exists to stop`,
        );
        continue;
      }

      // A FILE ON NEITHER SIDE FAILS THE BUDGET RATHER THAN BEING LEFT OUT OF IT. It is either
      // an artifact nobody loads, or a specifier form the walker does not read, and the second
      // one would silently report the smallest bundle this project has ever built.
      if (split.unaccounted.length > 0) {
        errors.push(
          `${budget.id}: ${String(split.unaccounted.length)} file(s) under ${budget.roots.join(', ')} are reached by neither the static closure of ${partition.entry} nor any dynamic import from it: ${split.unaccounted.map(chunkName).join(', ')}`,
        );
        continue;
      }

      wanted = [...(partition.side === 'initial' ? split.initial : split.deferred)];
    }

    const measurements: ArtifactMeasurement[] = wanted.map((relativePath) => {
      const content = readFileSync(join(repoRoot, relativePath));
      return {
        path: relativePath,
        rawBytes: content.byteLength,
        gzipBytes: gzipSizeOf(content),
      };
    });

    if (measurements.length === 0) {
      // AN EMPTY SIDE OF A BUNDLE THAT EXISTS IS A FAILURE, NOT A SKIP. `skip` says the artifact
      // has not been built yet, which is true of an empty directory and false of a split that
      // has been undone: a `client-js-deferred` reading zero would mean the three features are
      // back in the first paint, and printing that as "nothing to measure yet" is exactly how a
      // reverted deferral would pass unnoticed.
      if (budget.partition !== undefined && present.length > 0) {
        errors.push(
          `${budget.id}: the ${budget.partition.side} side of ${budget.partition.entry} is empty while ${String(present.length)} file(s) sit under ${budget.roots.join(', ')}. That is a split that no longer splits anything, not a bundle nobody has built`,
        );
        continue;
      }

      outcomes.push({
        id: budget.id,
        status: 'skip',
        source: 'artifact',
        message: `${budget.id}: no artifacts under ${budget.roots.join(', ')} (produced by ${budget.producedBy})`,
      });
      continue;
    }

    measuredCount += 1;
    const evaluation = evaluateBudget(budget.limitBytes, measurements, budget.quantity);
    // The quantity is printed with the figure. A reader comparing two budgets over the same
    // files has to be able to see that they are two quantities and not a contradiction.
    const summary = `${budget.id}: ${formatBytes(evaluation.totalBytes)} ${QUANTITY_LABEL[evaluation.quantity]} of ${formatBytes(evaluation.limitBytes)} across ${String(measurements.length)} file(s)`;

    outcomes.push(
      evaluation.ok
        ? { id: budget.id, status: 'ok', source: 'artifact', message: summary }
        : {
            id: budget.id,
            status: 'over',
            source: 'artifact',
            message: `${summary}, exceeded by ${formatBytes(evaluation.overBy)}`,
          },
    );
  }

  for (const budget of FONT_BUDGETS) {
    const files = collectFiles(
      join(repoRoot, budget.directory),
      ['.woff2', '.woff', '.ttf', '.otf'],
      repoRoot,
    );

    if (files.length === 0) {
      // One line for the three, because what is absent is the directory rather than a budget.
      outcomes.push({
        id: 'fonts',
        status: 'skip',
        source: 'artifact',
        message: `fonts, ${budget.theme}: no font files under ${budget.directory} (produced by ${budget.producedBy})`,
      });
      continue;
    }

    const measurements = files.map((relativePath) => {
      const content = readFileSync(join(repoRoot, relativePath));
      return { path: relativePath, rawBytes: content.byteLength, gzipBytes: gzipSizeOf(content) };
    });

    const named = (wanted: readonly string[]): ArtifactMeasurement[] => {
      const set = new Set(wanted);
      return measurements.filter((measurement) =>
        set.has(measurement.path.slice(measurement.path.lastIndexOf('/') + 1)),
      );
    };

    const firstPaint = named(budget.firstPaint);
    const latin = named(budget.latin);

    // A named file that is not there would otherwise measure as zero, which is the one way
    // either of these two budgets could pass by being wrong rather than by being small.
    const missing = (
      [
        ['fonts-first-paint', budget.firstPaint, firstPaint],
        ['fonts-latin', budget.latin, latin],
      ] as const
    ).filter(([, wanted, found]) => found.length !== wanted.length);

    if (missing.length > 0) {
      for (const [id, wanted, found] of missing) {
        errors.push(
          `${id}, ${budget.theme}: names ${String(wanted.length)} file(s) and found ${String(found.length)} under ${budget.directory}`,
        );
      }
      continue;
    }

    measuredCount += 1;

    for (const [id, limit, group] of [
      ['fonts-first-paint', FONT_BUDGET_LIMITS.firstPaintBytes, firstPaint],
      ['fonts-latin', FONT_BUDGET_LIMITS.latinBytes, latin],
      ['fonts-total', FONT_BUDGET_LIMITS.totalBytes, measurements],
    ] as const) {
      const evaluation = evaluateBudget(limit, group);
      const summary = `${id}, ${budget.theme}: ${formatBytes(evaluation.totalBytes)} ${QUANTITY_LABEL[evaluation.quantity]} of ${formatBytes(evaluation.limitBytes)} across ${String(group.length)} file(s)`;

      outcomes.push(
        evaluation.ok
          ? { id, status: 'ok', source: 'artifact', message: summary }
          : {
              id,
              status: 'over',
              source: 'artifact',
              message: `${summary}, exceeded by ${formatBytes(evaluation.overBy)}`,
            },
      );
    }
  }

  // THE BROWSER BUDGETS ARE READ FROM THE RECORD, NOT MEASURED HERE. A CPU throttle is
  // relative to the host, so a figure taken on whichever machine runs `pnpm gates` would name
  // a machine nobody will run again. What is checked here is the committed study: that it is
  // there, that it is a study, and that what it recorded is inside SPEC 20. A missing or
  // unreadable record fails, per T001: nothing to read reads exactly like nothing to find.
  const baselineResult = readBrowserBaseline(repoRoot);

  if (baselineResult.baseline === null) {
    errors.push(
      `${BROWSER_BASELINE_FILE}: ${baselineResult.reason ?? 'could not be read'}. The browser budgets of SPEC 20 have no measurement behind them until it is re-recorded by ${BROWSER_STUDY_WORKFLOW}`,
    );

    return { outcomes, errors, notes, measuredCount };
  }

  const baseline = baselineResult.baseline;
  const overBudget = new Map(checkCeilings(baseline).map((issue) => [issue.budget, issue.message]));

  notes.push(
    `browser figures recorded ${baseline.recordedAt} on ${baseline.environment.id}, ` +
      `${baseline.environment.cpuModel} x ${String(baseline.environment.cpuCount)}, ` +
      `Chrome ${String(baseline.browser.major)}, throttle ${String(baseline.throttleRate)}x measured ` +
      `${baseline.throttleRatio.median.toFixed(2)}x, commit ${baseline.commit.slice(0, 12)}`,
  );

  for (const budget of MEASURED_BUDGETS) {
    const recorded = recordedFigure(baseline, budget.id);
    const over = overBudget.get(budget.id);
    overBudget.delete(budget.id);

    if (over !== undefined) {
      outcomes.push({
        id: budget.id,
        status: 'over',
        source: 'recorded',
        message: `${budget.id}: ${budget.label} <= ${budget.limit}, measured ${over}`,
      });
      continue;
    }

    if (recorded === null) {
      outcomes.push({
        id: budget.id,
        status: 'not-measured',
        source: 'recorded',
        message: `${budget.id}: ${budget.label} <= ${budget.limit} (enforced by ${budget.enforcedBy})`,
      });
      continue;
    }

    // A REPORT IS PRINTED AS A REPORT. `of <limit>` after a figure reads as a comparison that
    // was made, and for these two rows no comparison exists: SPEC 20 records them and gates the
    // counts beside them. Printing them the same way as a checked budget is how an unchecked
    // number comes to look like a passed one, which is the defect class SPEC 0 now names.
    outcomes.push({
      id: budget.id,
      status: 'ok',
      source: 'recorded',
      message:
        budget.reportOnly === true
          ? `${budget.id}: ${recorded}, RECORDED AND NOT GATED (${budget.enforcedBy}, from ${BROWSER_BASELINE_FILE})`
          : `${budget.id}: ${recorded} of ${budget.limit} (${budget.enforcedBy}, from ${BROWSER_BASELINE_FILE})`,
    });
  }

  // A CEILING ISSUE NOBODY CLAIMED IS A FAILURE, NOT A DROPPED LINE. Everything above prints a
  // figure for a budget id, so an issue whose id no `MEASURED_BUDGETS` entry carries would have
  // been computed and thrown away, which is the same shape as the `cspViolations` defect one
  // level up: the check ran, the answer was right, and nothing read it.
  for (const [budgetId, message] of overBudget) {
    errors.push(
      `${budgetId}: over its SPEC 20 ceiling, measured ${message}, and no budget in MEASURED_BUDGETS ` +
        'answers for it. A figure checked by nothing that prints it is a check with no result',
    );
  }

  return { outcomes, errors, notes, measuredCount };
}

/**
 * The budget ids that are over their SPEC 20 limit on this run.
 *
 * @param report - What `collectBudgetOutcomes` measured
 * @returns The ids, in the order the budgets are declared
 */
export function overBudgetIds(report: BudgetReport): string[] {
  return report.outcomes
    .filter((outcome) => outcome.status === 'over')
    .map((outcome) => outcome.id);
}
