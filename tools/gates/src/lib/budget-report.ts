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
  CLIENT_JS_GESTURES,
  FONT_BUDGET_LIMITS,
  FONT_BUDGETS,
  MEASURED_BUDGETS,
  SIZE_BUDGETS,
  type SizeBudget,
} from '../config.js';
import {
  BASELINE_INPUT_PATHS,
  baselineFreshness,
  checkCeilings,
  readBrowserBaseline,
  recordedFigure,
} from './browser-baseline.js';
import { countCommitsSince } from './git.js';
import {
  evaluateBudget,
  formatBytes,
  gzipSizeOf,
  isBuiltOutputPath,
  type ArtifactMeasurement,
  type BudgetQuantity,
} from './budgets.js';
import {
  chunkName,
  partitionByGesture,
  partitionModuleGraph,
  type GesturePartition,
} from './module-graph.js';
import { readPublishedForm, type PublishedForm } from './published-form.js';
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
  /**
   * Lines that do not stop a build and must not read as information, today the one naming a
   * stale baseline. A stale record is not a failure of the product, and printing it as a note
   * is how nine tasks shipped on a record of a page that no longer existed.
   */
  readonly warnings: readonly string[];
  /** How many budgets were actually measured, as opposed to skipped. */
  readonly measuredCount: number;
  /**
   * How many of those were weighed over files a build produced.
   *
   * THE ONLY FIGURE THAT ANSWERS "DID I SEE A BUILD", and it is separate from `measuredCount`
   * because the two diverged in exactly the case the debt gate exists for. With every package's
   * `dist` removed, four budgets still weighed something: the two font budgets and the
   * two theme stylesheet budgets, whose roots include the committed `packages/theme/fonts`. A
   * count of weighed budgets therefore read four on a tree with nothing built in it, and
   * `budget-exceptions` passed while printing that it had read four budgets "under the built
   * artefacts of SPEC 20", which was false about every one of them.
   *
   * IT IS THREE SINCE 2026-08-31, AND THE ONE THAT LEFT IS THE ONE THAT LIED LOUDEST.
   * `theme-css-raw` now weighs the published form, so on a tree with nothing built it fails
   * naming the client bundle it could not read, instead of reporting the single committed
   * `fonts.css` as though it were the default theme's stylesheets. Measured A/B on one copy: six
   * gates fail on that tree where five did before.
   *
   * A committed input is still weighed and still gated. What it may not do is stand in for a
   * build, which is why the two counts are carried apart rather than one being dropped.
   */
  readonly builtCount: number;
  /** How many were weighed over committed inputs alone, such as the shipped font files. */
  readonly committedCount: number;
}

/**
 * The two things a test drives that a run of the gates takes from the repository.
 *
 * BOTH SEAMS EXIST BECAUSE THREE BRANCHES HAD NO RUNNER, found by the review of 2026-08-31. The
 * published form measurement, the unreachable catalog refusal and the file-not-in-the-catalog
 * refusal cannot be reached from the real tree without breaking the real tree, and a branch that
 * only runs when the repository is broken is a branch nothing can watch fail. Both default to the
 * real thing, so a gate run is unchanged and nothing here is a test-only code path.
 */
export interface BudgetReportOptions {
  /** The budgets to weigh. Defaults to every SPEC 20 size budget. */
  readonly budgets?: readonly SizeBudget[];
  /** How the published form is read. Defaults to the renderer's own asset catalog. */
  readonly publishedForm?: (repoRoot: string) => PublishedForm;
}

/**
 * Measures every SPEC 20 budget against the built artifacts and the committed browser study.
 *
 * @param repoRoot - Absolute repository root
 * @param options - Seams a test drives; every one of them defaults to the real thing
 * @returns One outcome per budget, plus anything that is wrong with the measurement itself
 */
export function collectBudgetOutcomes(
  repoRoot: string,
  options: BudgetReportOptions = {},
): BudgetReport {
  const outcomes: BudgetOutcome[] = [];
  const errors: string[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];
  let measuredCount = 0;
  let builtCount = 0;
  let committedCount = 0;

  /** Counts one weighed budget on the side its files came from. */
  const countWeighed = (measured: readonly ArtifactMeasurement[]): void => {
    measuredCount += 1;
    if (measured.some((measurement) => isBuiltOutputPath(measurement.path))) builtCount += 1;
    else committedCount += 1;
  };

  // THE GESTURE DIVISION IS COMPUTED ONCE PER ENTRY AND ITS COMPLAINTS ARE REPORTED ONCE. Six
  // budgets share one bundle, so walking it six times would print the same unclaimed chunk six
  // times and train a reader to skip all six.
  const gestureSplits = new Map<string, GesturePartition>();
  const budgets = options.budgets ?? SIZE_BUDGETS;
  const publishedFormOf = options.publishedForm ?? readPublishedForm;

  for (const budget of budgets) {
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

      if (partition.gesture !== undefined) {
        let divided = gestureSplits.get(partition.entry);

        if (divided === undefined) {
          divided = partitionByGesture(repoRoot, split, CLIENT_JS_GESTURES);
          gestureSplits.set(partition.entry, divided);

          // A DEFERRED CHUNK NO GESTURE CLAIMS FAILS, for the reason the unaccounted set exists
          // one level up. It is either dead output or a gesture nobody named, and both would be
          // silently unbudgeted the moment the division replaced the single cap over the union.
          if (divided.unclaimed.length > 0) {
            errors.push(
              `${partition.entry}: ${String(divided.unclaimed.length)} deferred chunk(s) are downloaded by no declared gesture: ${divided.unclaimed.map(chunkName).join(', ')}. Splitting the deferred budget by gesture leaves nothing over, or it leaves a chunk nobody pays a budget for`,
            );
          }

          for (const [id, gestureSplit] of divided.byGesture) {
            for (const root of gestureSplit.missingRoots) {
              errors.push(
                `gesture ${id}: the chunk ${root} it is declared to start from is not on the deferred side of ${partition.entry}. A budget over nothing passes on every run`,
              );
            }

            for (const { root, matches } of gestureSplit.ambiguousRoots) {
              errors.push(
                `gesture ${id}: the chunk name ${root} matches ${String(matches.length)} deferred chunks, ${matches.map(chunkName).join(', ')}, so what this budget weighs is undecided`,
              );
            }
          }
        }

        const gestureSplit = divided.byGesture.get(partition.gesture);

        if (gestureSplit === undefined) {
          errors.push(
            `${budget.id}: names the gesture ${partition.gesture}, which CLIENT_JS_GESTURES does not declare`,
          );
          continue;
        }

        if (gestureSplit.missingRoots.length > 0 || gestureSplit.ambiguousRoots.length > 0) {
          continue;
        }

        wanted = [...gestureSplit.files];
      }
    }

    // THE FORM IS CHOSEN BEFORE THE BYTES ARE COUNTED, per the SPEC 20 ruling of 2026-08-31. A
    // budget over the published form weighs the file as the asset catalog serves it, which is
    // longer than the file on disk wherever that file names a sibling. Reading the catalog can
    // fail only in ways that mean the check cannot be made, so it fails the budget rather than
    // falling back to the form nobody downloads: that substitution is the defect the move fixed.
    let published: PublishedForm | null = null;

    if (budget.form === 'published' && wanted.length > 0) {
      try {
        published = publishedFormOf(repoRoot);
      } catch (cause) {
        errors.push(
          `${budget.id}: weighs the published form and the asset catalog could not be read: ${cause instanceof Error ? cause.message : String(cause)}. Weighing the files on disk instead would report a form no reader receives`,
        );
        continue;
      }
    }

    // A `const` copy, because the two closures below only narrow away the null through one.
    const publishedSizes = published;

    // TWO FILES WITH ONE BASE NAME FAIL RATHER THAN SHARING A FIGURE, found by the review of
    // 2026-08-31 as a latent defect. The catalog is keyed by the name a file has on disk, because
    // that is the name a stylesheet or a module refers to it by, and a budget spanning two roots
    // could hold `a/x.js` and `b/x.js`. Both would read one catalog entry, so one file would be
    // weighed twice and the other never, silently. No budget has such a pair today, which is why
    // this is a refusal rather than a second key: what a served reference cannot contain is two
    // assets of one name, and a budget that produced one is not describing a served reference.
    const collisions =
      publishedSizes === null
        ? []
        : [...groupByName(wanted).values()].filter((paths) => paths.length > 1);

    if (collisions.length > 0) {
      errors.push(
        `${budget.id}: ${String(collisions.length)} base name(s) under ${budget.roots.join(', ')} are carried by more than one file: ${collisions.map((paths) => paths.join(' and ')).join('; ')}. A served reference holds one asset per name, so these cannot both be weighed as published`,
      );
      continue;
    }

    // A FILE THE CATALOG DOES NOT HOLD IS A FAILURE, NOT A FALLBACK. The two lists are built two
    // different ways, one by walking the roots and one by following what a page loads, and the
    // whole value of weighing the published form is that they describe one artefact. A file on
    // one side and not the other means they have stopped doing so.
    const missing =
      publishedSizes === null
        ? []
        : wanted.filter((relativePath) => !publishedSizes.has(chunkName(relativePath)));

    if (missing.length > 0) {
      errors.push(
        `${budget.id}: ${String(missing.length)} file(s) under ${budget.roots.join(', ')} are not in the asset catalog a served reference is built from: ${missing.map(chunkName).join(', ')}. The budget's file walk and what a page actually loads have stopped describing one artefact`,
      );
      continue;
    }

    const measurements: ArtifactMeasurement[] = wanted.map((relativePath) => {
      const served = publishedSizes?.get(chunkName(relativePath));
      // BOTH QUANTITIES COME FROM ONE FORM. Measuring the raw size of what ships and the gzip
      // size of what does not is one artefact reported as two, which is the shape of the defect
      // this whole move is about rather than a rounding difference.
      const content = served ?? readFileSync(join(repoRoot, relativePath));

      return {
        path: relativePath,
        rawBytes: content.byteLength,
        gzipBytes: gzipSizeOf(Buffer.from(content)),
      };
    });

    if (measurements.length === 0) {
      // AN EMPTY SIDE OF A BUNDLE THAT EXISTS IS A FAILURE, NOT A SKIP. `skip` says the artifact
      // has not been built yet, which is true of an empty directory and false of a split that
      // has been undone: a gesture budget reading zero would mean that feature is back in the
      // first paint, and printing that as "nothing to measure yet" is exactly how a reverted
      // deferral would pass unnoticed.
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

    countWeighed(measurements);
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

    // A FONT FILE IS COMMITTED AND NOT BUILT, and this is where that shows. `pnpm build` produces
    // nothing under `packages/*/fonts`: the files are in the tree, so these budgets weigh and gate
    // exactly as before and answer for no build at all.
    countWeighed(measurements);

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

    return { outcomes, errors, notes, warnings, measuredCount, builtCount, committedCount };
  }

  const baseline = baselineResult.baseline;
  const overBudget = new Map(checkCeilings(baseline).map((issue) => [issue.budget, issue.message]));

  notes.push(
    `browser figures recorded ${baseline.recordedAt} on ${baseline.environment.id}, ` +
      `${baseline.environment.cpuModel} x ${String(baseline.environment.cpuCount)}, ` +
      `Chrome ${String(baseline.browser.major)}, throttle ${String(baseline.throttleRate)}x measured ` +
      `${baseline.throttleRatio.median.toFixed(2)}x, commit ${baseline.commit.slice(0, 12)}`,
  );

  // THE RECORD IS DATED AGAINST THE TREE ON EVERY RUN. The figures below are read out of a
  // committed file that does not move when the page does, and twice the figure being read
  // predated the page by a chain of sessions. There is no failing distance, for the reason
  // `baselineFreshness` states; what there is instead is this line, stale as a warning and
  // never as information.
  const distance = countCommitsSince(repoRoot, baseline.commit, BASELINE_INPUT_PATHS);
  const freshness = baselineFreshness(baseline, distance.count, distance.reason);

  if (freshness.state === 'stale') {
    warnings.push(freshness.message);
  } else {
    notes.push(freshness.message);
  }

  // AND THE QUALIFIER TRAVELS WITH EVERY FIGURE IT QUALIFIES, decided by the review before M4,
  // which asked whether a stale record should fail rather than warn. The answer is that it should
  // not fail, for the reason `baselineFreshness` already gives: any failing distance N admits N
  // sessions of the silence it exists to end, and N = 0 demands a study run on every commit that
  // touches `packages/`, a cadence CI cannot hold. What was wrong was narrower. The staleness was
  // one warning among thirty findings while each recorded row printed `figure of limit` with
  // nothing on it, and a reader who scrolls to the row they came for reads a number that looks
  // checked. It is checked; it is checked against a page that may no longer exist, and that is a
  // property of the number rather than of the run. So the marker is on the line.
  const staleMark = freshness.state === 'stale' ? ', FROM A STALE RECORD' : '';

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
          ? `${budget.id}: ${recorded}, RECORDED AND NOT GATED (${budget.enforcedBy}, from ${BROWSER_BASELINE_FILE}${staleMark})`
          : `${budget.id}: ${recorded} of ${budget.limit} (${budget.enforcedBy}, from ${BROWSER_BASELINE_FILE}${staleMark})`,
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

  return { outcomes, errors, notes, warnings, measuredCount, builtCount, committedCount };
}

/**
 * The paths of a budget's file set, grouped by the base name the asset catalog keys them under.
 *
 * @param paths - Repository relative paths
 * @returns Base name to every path carrying it, in walk order
 */
function groupByName(paths: readonly string[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const path of paths) {
    const name = chunkName(path);
    grouped.set(name, [...(grouped.get(name) ?? []), path]);
  }

  return grouped;
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
