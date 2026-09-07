/**
 * The committed browser figures, and what a later run is allowed to differ from them by.
 *
 * A CPU throttle is relative to the host, so a figure without a machine attached is a number
 * nobody can compare with another number. The baseline therefore carries the machine, the
 * Chrome major, the launch flags, the sample count and the spread beside every figure, and the
 * checks below refuse to compare across a change in any of them rather than comparing anyway.
 *
 * TWO CHECKS, AND THEY ANSWER DIFFERENT QUESTIONS.
 *
 * The absolute one asks whether the product is inside SPEC 20. It is the same question wherever
 * it is asked, so it is asked of the committed record as well, in `pnpm gates`, where it needs
 * no browser.
 *
 * The relative one asks whether a change made the product slower. It only means anything
 * between two measurements of the same machine and the same browser: the day a runner image
 * ships a slower Chrome, a figure moving from 60 ms to 130 ms is not a regression and firing
 * on it teaches everyone to ignore the check. So when the major moves, the relative check does
 * not fire, the baseline is reported stale, and re-recording it is a deliberate act.
 *
 * THE ALLOWANCE IS THE MEASURED SPREAD, NOT A PERCENTAGE. What is compared is the median of a
 * study against the median of the recorded study, and the allowance is one standard deviation
 * of the recorded per run samples. That is conservative on purpose: the standard error of a
 * median of twenty five samples is several times smaller than the per sample deviation, so a
 * run to run wobble does not reach it, while a real regression of a fifth of the budget does.
 *
 * WHAT IS ASSERTED AND WHAT IS ONLY RECORDED IS ITSELF DATA HERE, in `ASSERTED_FIGURES` and
 * `RECORDED_NOT_ASSERTED`, and a test walks the committed file against both lists. That is not
 * decoration. `cspViolations` sat in this record from the day it was written and no committed
 * check read it, so a baseline carrying policy violations passed `pnpm gates` in silence while
 * the same violations failed the study job, and the field sitting in the file read as coverage.
 * SPEC 0 calls the class measured but never asserted. A figure recorded here is either checked
 * or listed as unchecked with the reason, and there is no third state.
 *
 * AND HOW GOOD A FIGURE IS, IS DATA HERE TOO, in `pageBytesFigures`. The three byte columns, their
 * sum and the headroom under the ceiling were hand written into the SPEC 20 row, into the
 * `BROWSER_CEILINGS` comment and into this repository's prose, and the only assertions that touched
 * them compared the committed record with itself, which proves the comparison and not the
 * construction. They are derived from the record and the live ceiling now, and each one says which
 * of two things it is, because they are not equally good and writing them as one line would be the
 * dressing up this file exists to stop:
 *
 * - MEASURABLE. The stylesheet and bundle columns equal `theme-css-raw` and `client-js-raw` of the
 *   published form byte for byte, and this repository weighs both off a built tree, so the record's
 *   two columns are held against an instrument rather than believed.
 * - RECORDED. The document column comes from a browser study on a named machine and nothing here
 *   can take it again, so it is as good as that run and no better. The total contains it and is
 *   therefore recorded too, and the headroom is arithmetic over the live ceiling and that total.
 *   What holds all three is that they are typed nowhere: every prose home is compared with the
 *   derivation, so a re-record that leaves one behind is red rather than quiet.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BROWSER_BASELINE_FILE,
  BROWSER_CEILINGS,
  PAGE_SAMPLE_LANGUAGE_MEASUREMENT,
} from '../config.js';

/** What one figure looked like across the runs of a study. */
export interface BaselineSpread {
  readonly samples: number;
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly standardDeviation: number;
}

/**
 * The bytes the measured page hands the main thread, by kind.
 *
 * These are the one class of figure in this file that no processor moves: all six studies of
 * 2026-08-10, on five processors, reported the three columns identical to the byte and
 * identical between the twenty five runs of each study.
 */
export interface BaselineParsedBytes {
  /** The served document itself, decoded. */
  readonly documentBytes: number;
  readonly cssBytes: number;
  readonly jsBytes: number;
}

/** The committed record of one machine, one browser and one measurement. */
export interface BrowserBaseline {
  /** Date the study was run, as `YYYY-MM-DD`. */
  readonly recordedAt: string;
  /** Commit the study ran against, so a figure can be tied to a tree. */
  readonly commit: string;
  /**
   * What a reader of this file has to know that the numbers do not say.
   *
   * It carries, today, the two things a later reader would otherwise get wrong: which figures
   * here are gated and which are recorded for context only, and that the runner's CPU model is
   * not fixed within one image, so a movement between two records is not necessarily a change
   * to the product.
   */
  readonly note?: string;
  readonly environment: {
    readonly id: string;
    readonly label: string;
    readonly cpuModel: string;
    readonly cpuCount: number;
  };
  readonly browser: { readonly version: string; readonly major: number };
  readonly chromeArgs: readonly string[];
  readonly throttleRate: number;
  /** Measured slowdown, so a throttle that stopped taking is visible in the record. */
  readonly throttleRatio: BaselineSpread;
  /** Wall clock time to interactive. RECORDED AND NOT GATED, per SPEC 20. */
  readonly ttiMs: BaselineSpread;
  /** Where the time went, in medians, because a figure over budget has to say what to look at. */
  readonly ttiPhaseMs: {
    readonly transfer: number;
    readonly parse: number;
    readonly script: number;
    readonly firstContentfulPaint: number;
  };
  /** Total main thread task time over the load. RECORDED AND NOT GATED, per SPEC 20. */
  readonly mainThreadMs: BaselineSpread;
  /** Main thread tasks over 50 ms, as a median of the study's runs. Gated. */
  readonly longTaskCount: BaselineSpread;
  /** What the page gives the main thread to parse and compile. Gated. */
  readonly parsedBytes: BaselineParsedBytes;
  readonly peakHeapBytes: BaselineSpread;
  readonly externalRequests: number;
  readonly cspViolations: number;
  /** What is over its ceiling today, named here so a reader of the file is not surprised. */
  readonly overBudget: readonly string[];
}

/**
 * Every recorded figure a committed check reads, keyed by the budget id it answers.
 *
 * The list is exported so a test can hold the file to it. A figure added to the record and to
 * neither list fails that test, which is the only defence against the next `cspViolations`.
 */
export const ASSERTED_FIGURES: Readonly<Record<string, string>> = {
  longTaskCount: 'long-tasks',
  parsedBytes: 'page-bytes and served-document',
  peakHeapBytes: 'client-memory',
  externalRequests: 'external-requests',
  cspViolations: 'csp-violations',
};

/**
 * Every recorded figure no check reads, with the reason it is here rather than checked.
 *
 * A reason is required. "Nobody got round to it" is the state this list exists to make
 * visible, and writing it down is what turns it from an absence into a decision.
 */
export const RECORDED_NOT_ASSERTED: Readonly<Record<string, string>> = {
  recordedAt: 'identity of the study, not a measurement',
  commit: 'identity of the study, read by the freshness naming rather than by a ceiling',
  note: 'prose for a reader of the file',
  environment: 'identity of the machine, read by the staleness check rather than by a ceiling',
  browser: 'identity of the browser, read by the staleness check',
  chromeArgs: 'identity of the launch, recorded so two studies can be told apart',
  throttleRate: 'what was requested; the harness fails when the measured ratio does not match it',
  throttleRatio: 'proof the throttle took, checked in the harness at measurement time',
  ttiMs:
    'SPEC 20 retired the TTI ceiling on 2026-08-10. Six studies on five processors measured the ' +
    'same bytes between 163.7 and 216.1 ms, a range of 25.7 percent of the median, so the ' +
    'quantity is recorded and printed and nothing passes or fails on it',
  ttiPhaseMs: 'the split of a figure that is itself recorded and not gated',
  mainThreadMs:
    'measured on the same six studies at a range of 27.0 percent of its median, slightly worse ' +
    'than the wall clock it was proposed to replace, so no threshold was set. Recorded because ' +
    'a page whose work moves says where to look, and printed beside the two counts that are gated',
  overBudget: 'the record of what is over, checked against the ceilings rather than by them',
};

/**
 * The paths whose commits change what the study measures.
 *
 * The measured page is built from the packages and served by the harness, whose fixture
 * generator is part of what the page weighs, so a commit touching either can move the figures.
 * `baseline.json` itself is deliberately not in the list: a re-record lands one commit after
 * the study it records, and a pathspec covering the record would count every re-record as work
 * the record has not seen.
 */
export const BASELINE_INPUT_PATHS: readonly string[] = ['packages', 'tools/browser-budget/src'];

/** Whether the committed record still describes the committed tree. */
export interface BaselineFreshness {
  readonly state: 'current' | 'stale' | 'unknown';
  /** The line a gate prints. Warning material when stale, a note otherwise. */
  readonly message: string;
}

/**
 * Names whether the committed record predates the tree, from the commit it carries.
 *
 * THIS NAMES AND DOES NOT FAIL, AND THE ABSENCE OF A FAILING DISTANCE IS A DECISION. Twice a
 * recorded figure was acted on while the tree had moved past it: nine tasks, T026 through
 * T033, shipped on one record, and the TX chain shipped on the next, so a recorded 4,998 was
 * being read while the live figure was 18,656. Any failing distance N > 0 admits N sessions
 * of exactly that silence, and N = 0 would demand a runner dispatch on every commit that
 * touches `packages/`, which is not a cadence a study taken on CI can hold. So the mechanism
 * is visibility in two places: this line on every run, and the commit carried beside the
 * figure in any exception entry that cites the record, which `budget-exceptions` enforces.
 *
 * ASKED AGAIN BY THE REVIEW BEFORE M4, AND THE ANSWER IS STILL WARN, WITH ONE CORRECTION. The
 * argument above holds and nothing in it has moved: there is no failing distance that is both
 * honest and holdable. What did not hold is where the qualifier lived. It was one warning among
 * roughly thirty findings of the budgets gate, and every recorded row underneath printed
 * `figure of limit` with nothing on it, so a reader who scrolls to the row they came for reads a
 * figure that looks checked. It is checked, against a page that may no longer exist, and that is
 * a property of the figure and not of the run. Since 2026-08-28 the recorded rows carry
 * `FROM A STALE RECORD` in their own text, in `budget-report.ts`, and this line stays as the
 * explanation. A third place was considered and refused: making the gate skip when the record is
 * stale, which would have hidden a recorded figure that is over its ceiling behind a skip, and an
 * over budget has to be loud whatever it was measured on.
 *
 * @param baseline - The committed record
 * @param commitsSince - Commits touching {@link BASELINE_INPUT_PATHS} past the record's
 *   commit, or null when git could not answer
 * @param reason - Why there is no count, when there is none
 * @returns The state and the line to print
 */
export function baselineFreshness(
  baseline: BrowserBaseline,
  commitsSince: number | null,
  reason?: string,
): BaselineFreshness {
  const commit = baseline.commit.slice(0, 12);

  if (commitsSince === null) {
    return {
      state: 'unknown',
      message:
        `whether the record at commit ${commit} still describes this tree could not be told: ` +
        `${reason ?? 'git gave no reason'}. The ceilings were checked against the record as committed`,
    };
  }

  if (commitsSince === 0) {
    return {
      state: 'current',
      message: `the record at commit ${commit} is current: no commit touching ${BASELINE_INPUT_PATHS.join(' or ')} has landed past it`,
    };
  }

  const landed = commitsSince === 1 ? 'commit touching' : 'commits touching';
  const verb = commitsSince === 1 ? 'has' : 'have';

  return {
    state: 'stale',
    message:
      `BASELINE STALE: the record was taken at commit ${commit} and ${String(commitsSince)} ${landed} ` +
      `${BASELINE_INPUT_PATHS.join(' or ')} ${verb} landed since, so the recorded figures ` +
      `describe a page that may no longer exist. The ceilings still gate the record as committed; ` +
      `re-record it deliberately via the study workflow before acting on a recorded figure`,
  };
}

/** One thing wrong with a baseline, or with a study measured against one. */
export interface BaselineIssue {
  readonly budget: string;
  readonly message: string;
  /**
   * `over-budget` is the product and stops a build; `stale` and `malformed` are the record;
   * `report` is a figure SPEC 20 records without gating, printed and never fatal.
   */
  readonly kind: 'over-budget' | 'stale' | 'malformed' | 'report';
}

/** What a study has to report for the relative check to be possible. */
export interface MeasuredStudy {
  readonly environmentId: string;
  /** The processor the figures were taken on, which the environment id does not identify. */
  readonly cpuModel: string;
  readonly browserMajor: number;
  readonly ttiMedianMs: number;
  readonly peakHeapMedianBytes: number;
  readonly externalRequests: number;
  readonly cspViolations: number;
  readonly longTaskMedian: number;
  readonly parsedBytes: BaselineParsedBytes;
}

/**
 * The bytes one page load hands the main thread as source: the document, the CSS and the JS.
 *
 * Fonts and images are deliberately not in it. They are bytes a reader waits for and they are
 * bounded by the three font caps; they are not bytes anything parses or compiles, which is what
 * this quantity is about.
 *
 * @param bytes - The three columns
 * @returns Their sum
 */
export function pageBytesOf(bytes: BaselineParsedBytes): number {
  return bytes.documentBytes + bytes.cssBytes + bytes.jsBytes;
}

/**
 * Reads a committed baseline, refusing anything that is not one.
 *
 * A MALFORMED RECORD IS A FINDING RATHER THAN A DEFAULT. A baseline that parsed to zeros would
 * pass every ceiling in this file while describing nothing, which is the shape of failure this
 * whole package exists to avoid.
 *
 * @param value - Whatever the file parsed to
 * @returns The baseline
 * @throws Error when a field the checks depend on is absent or of the wrong type
 */
export function readBaseline(value: unknown): BrowserBaseline {
  if (value === null || typeof value !== 'object') {
    throw new Error('the browser baseline is not an object');
  }

  const record = value as Partial<BrowserBaseline>;

  const spread = (name: string, candidate: BaselineSpread | undefined): BaselineSpread => {
    if (
      candidate === undefined ||
      typeof candidate.median !== 'number' ||
      typeof candidate.samples !== 'number' ||
      typeof candidate.standardDeviation !== 'number'
    ) {
      throw new Error(`the browser baseline carries no usable ${name}`);
    }

    return candidate;
  };

  if (typeof record.environment?.id !== 'string' || typeof record.browser?.major !== 'number') {
    throw new Error('the browser baseline names no machine and no browser, so it compares nothing');
  }

  spread('ttiMs', record.ttiMs);
  spread('mainThreadMs', record.mainThreadMs);
  spread('longTaskCount', record.longTaskCount);
  spread('peakHeapBytes', record.peakHeapBytes);

  const bytes = record.parsedBytes;
  if (
    bytes === undefined ||
    typeof bytes.documentBytes !== 'number' ||
    typeof bytes.cssBytes !== 'number' ||
    typeof bytes.jsBytes !== 'number'
  ) {
    throw new Error('the browser baseline carries no usable parsedBytes');
  }

  return record as BrowserBaseline;
}

/**
 * Checks the recorded figures against the SPEC 20 ceilings.
 *
 * EVERY GATED FIGURE IN THE RECORD IS READ HERE. The pair of this and `compareToBaseline` is
 * where the same figure gets checked in one and forgotten in the other, which is what happened
 * to `cspViolations`, so the two are kept symmetrical and the asymmetries that remain are named
 * in `RECORDED_NOT_ASSERTED`.
 *
 * @param baseline - The committed record
 * @returns One issue per figure over its ceiling, empty when everything is inside
 */
export function checkCeilings(baseline: BrowserBaseline): BaselineIssue[] {
  const issues: BaselineIssue[] = [];

  if (baseline.longTaskCount.median > BROWSER_CEILINGS.longTaskCount) {
    issues.push({
      budget: 'long-tasks',
      kind: 'over-budget',
      message:
        `${baseline.longTaskCount.median.toFixed(0)} tasks over 50 ms against ` +
        `${String(BROWSER_CEILINGS.longTaskCount)}, as the median of ` +
        `${String(baseline.longTaskCount.samples)} navigations on ${baseline.environment.id}. ` +
        `They took ${baseline.mainThreadMs.median.toFixed(1)} ms of main thread task time between them`,
    });
  }

  const pageBytes = pageBytesOf(baseline.parsedBytes);
  if (pageBytes > BROWSER_CEILINGS.pageBytes) {
    issues.push({
      budget: 'page-bytes',
      kind: 'over-budget',
      message:
        `${String(pageBytes)} bytes against ${String(BROWSER_CEILINGS.pageBytes)}: ` +
        `${String(baseline.parsedBytes.documentBytes)} document, ` +
        `${String(baseline.parsedBytes.cssBytes)} CSS, ${String(baseline.parsedBytes.jsBytes)} JS`,
    });
  }

  if (baseline.peakHeapBytes.median > BROWSER_CEILINGS.peakHeapBytes) {
    issues.push({
      budget: 'client-memory',
      kind: 'over-budget',
      message: `${(baseline.peakHeapBytes.median / (1024 * 1024)).toFixed(1)} MB against ${String(BROWSER_CEILINGS.peakHeapBytes / (1024 * 1024))} MB`,
    });
  }

  if (baseline.externalRequests > BROWSER_CEILINGS.externalRequests) {
    issues.push({
      budget: 'external-requests',
      kind: 'over-budget',
      message: `${String(baseline.externalRequests)} request(s) left the origin`,
    });
  }

  // THE FIELD THAT NOTHING READ. A baseline recorded with policy violations in it passed this
  // function in silence from the day the record was written until 2026-08-10, while the study
  // job failed on the same figure. SPEC 19.2 is the strongest claim this project makes and the
  // committed half of its proof asserted nothing.
  if (baseline.cspViolations > BROWSER_CEILINGS.cspViolations) {
    issues.push({
      budget: 'csp-violations',
      kind: 'over-budget',
      message:
        `${String(baseline.cspViolations)} policy violation(s) under the strict policy, against ` +
        `${String(BROWSER_CEILINGS.cspViolations)}. SPEC 19.2 is the claim, and a recorded ` +
        'violation is that claim being false on the machine that measured it',
    });
  }

  if (baseline.parsedBytes.documentBytes > BROWSER_CEILINGS.servedDocumentBytes) {
    issues.push({
      budget: 'served-document',
      kind: 'over-budget',
      message: `${String(baseline.parsedBytes.documentBytes)} bytes against ${String(BROWSER_CEILINGS.servedDocumentBytes)}`,
    });
  }

  return issues;
}

/**
 * Compares a fresh study against the committed baseline.
 *
 * @param baseline - The committed record
 * @param study - What was just measured
 * @returns Issues, with `stale` meaning the two are not comparable rather than that anything
 *   regressed, and `report` meaning a quantity SPEC 20 records without gating
 */
export function compareToBaseline(
  baseline: BrowserBaseline,
  study: MeasuredStudy,
): BaselineIssue[] {
  const issues: BaselineIssue[] = [];

  if (study.longTaskMedian > BROWSER_CEILINGS.longTaskCount) {
    issues.push({
      budget: 'long-tasks',
      kind: 'over-budget',
      message: `${study.longTaskMedian.toFixed(0)} tasks over 50 ms against ${String(BROWSER_CEILINGS.longTaskCount)}`,
    });
  }

  const pageBytes = pageBytesOf(study.parsedBytes);
  if (pageBytes > BROWSER_CEILINGS.pageBytes) {
    issues.push({
      budget: 'page-bytes',
      kind: 'over-budget',
      message:
        `${String(pageBytes)} bytes against ${String(BROWSER_CEILINGS.pageBytes)}: ` +
        `${String(study.parsedBytes.documentBytes)} document, ${String(study.parsedBytes.cssBytes)} CSS, ` +
        `${String(study.parsedBytes.jsBytes)} JS`,
    });
  }

  if (study.parsedBytes.documentBytes > BROWSER_CEILINGS.servedDocumentBytes) {
    issues.push({
      budget: 'served-document',
      kind: 'over-budget',
      message: `${String(study.parsedBytes.documentBytes)} bytes against ${String(BROWSER_CEILINGS.servedDocumentBytes)}`,
    });
  }

  if (study.peakHeapMedianBytes > BROWSER_CEILINGS.peakHeapBytes) {
    issues.push({
      budget: 'client-memory',
      kind: 'over-budget',
      message: `${(study.peakHeapMedianBytes / (1024 * 1024)).toFixed(1)} MB against ${String(BROWSER_CEILINGS.peakHeapBytes / (1024 * 1024))} MB`,
    });
  }

  if (study.externalRequests > BROWSER_CEILINGS.externalRequests) {
    issues.push({
      budget: 'external-requests',
      kind: 'over-budget',
      message: `${String(study.externalRequests)} request(s) left the origin`,
    });
  }

  if (study.cspViolations > BROWSER_CEILINGS.cspViolations) {
    issues.push({
      budget: 'csp-violations',
      kind: 'over-budget',
      message: `${String(study.cspViolations)} policy violation(s) under the strict policy`,
    });
  }

  if (study.environmentId !== baseline.environment.id) {
    issues.push({
      budget: 'tti',
      kind: 'stale',
      message:
        `measured on ${study.environmentId} and the baseline is from ${baseline.environment.id}. ` +
        'The relative check does not apply across machines, so only the ceilings were checked',
    });

    return issues;
  }

  // THE ENVIRONMENT ID DOES NOT IDENTIFY THE PROCESSOR, and the run of 2026-08-10 proved it.
  // `github-actions/ubuntu24/X64` and Chrome 150 were identical between two studies taken on an
  // AMD EPYC 9V74 and an AMD EPYC 9V45, so the relative check applied across two machines and
  // the TTI median came out 66 ms lower with nothing reporting that anything had changed. A CPU
  // throttle is relative to the host, which is the premise of this whole package: two figures
  // from two processors are two measurements and neither is a movement in the other.
  if (study.cpuModel !== baseline.environment.cpuModel) {
    issues.push({
      budget: 'tti',
      kind: 'stale',
      message:
        `measured on ${study.cpuModel} and the baseline is from ${baseline.environment.cpuModel}. ` +
        `TTI reads ${study.ttiMedianMs.toFixed(1)} ms against a recorded ${baseline.ttiMs.median.toFixed(1)} ms, ` +
        'and the difference is not attributable to the product. A shared runner pool changes ' +
        'processor without changing its image, so re-record the baseline deliberately rather ' +
        'than reading this as a change either way. Only the ceilings were checked',
    });

    return issues;
  }

  if (study.browserMajor !== baseline.browser.major) {
    issues.push({
      budget: 'tti',
      kind: 'stale',
      message:
        `Chrome ${String(study.browserMajor)} against a baseline from Chrome ${String(baseline.browser.major)}. ` +
        `TTI moved from ${baseline.ttiMs.median.toFixed(1)} ms to ${study.ttiMedianMs.toFixed(1)} ms. ` +
        'An image bump is not a regression, so re-record the baseline deliberately rather than ' +
        'reading this as a change to the product',
    });

    return issues;
  }

  // TTI IS REPORTED HERE AND GATES NOTHING, per SPEC 20. The comparison is still worth printing
  // on the one occasion it means anything, which is the same machine and the same browser, and
  // it is worth nothing as a pass or a fail: the spread across the pool's processors is a
  // quarter of the figure, so a red build on this number would be a red build on the runner
  // somebody happened to get.
  const allowance = baseline.ttiMs.standardDeviation;
  if (study.ttiMedianMs > baseline.ttiMs.median + allowance) {
    issues.push({
      budget: 'tti',
      kind: 'report',
      message:
        `${study.ttiMedianMs.toFixed(1)} ms against a recorded ${baseline.ttiMs.median.toFixed(1)} ms ` +
        `on the same machine and the same browser, which is beyond the ${allowance.toFixed(1)} ms ` +
        'this measurement varies by. SPEC 20 records TTI and gates the two counts beside it, so ' +
        'this is a line to read rather than a build to stop',
    });
  }

  return issues;
}

/** A committed baseline, or the reason there is none to read. */
export interface BaselineRead {
  readonly baseline: BrowserBaseline | null;
  readonly reason?: string;
}

/**
 * Reads the committed baseline off disk.
 *
 * @param repoRoot - Absolute path to the repository root
 * @returns The baseline, or why there is none
 */
export function readBrowserBaseline(repoRoot: string): BaselineRead {
  let text: string;
  try {
    text = readFileSync(join(repoRoot, BROWSER_BASELINE_FILE), 'utf8');
  } catch {
    return { baseline: null, reason: 'the file is not in the repository' };
  }

  try {
    return { baseline: readBaseline(JSON.parse(text)) };
  } catch (cause) {
    return { baseline: null, reason: cause instanceof Error ? cause.message : String(cause) };
  }
}

/**
 * The budget ids whose figure comes out of the committed record, exactly the ids
 * {@link recordedFigure} answers.
 *
 * ONE HOME, TWO READERS: `recordedFigure` prints these and the `budget-exceptions` gate
 * requires a live entry over one of them to carry the commit its figure was measured at,
 * because the record does not move with the tree. A test holds this list to the function, so
 * a budget added to one and not the other is a failure rather than a silent gap.
 */
export const BASELINE_ANSWERED_BUDGET_IDS: readonly string[] = [
  'tti',
  'main-thread-work',
  'long-tasks',
  'page-bytes',
  'client-memory',
  'external-requests',
  'csp-violations',
  'served-document',
];

/**
 * The recorded figure for one budget id, formatted for a gate line.
 *
 * @param baseline - The committed record
 * @param budgetId - Id from `MEASURED_BUDGETS`
 * @returns The figure, or null when this baseline says nothing about that budget
 */
export function recordedFigure(baseline: BrowserBaseline, budgetId: string): string | null {
  switch (budgetId) {
    case 'tti':
      return `${baseline.ttiMs.median.toFixed(1)} ms, median of ${String(baseline.ttiMs.samples)}`;
    case 'main-thread-work':
      return `${baseline.mainThreadMs.median.toFixed(1)} ms, median of ${String(baseline.mainThreadMs.samples)}`;
    case 'long-tasks':
      return baseline.longTaskCount.median.toFixed(0);
    case 'page-bytes':
      return `${(pageBytesOf(baseline.parsedBytes) / 1024).toFixed(1)} KB raw`;
    case 'client-memory':
      return `${(baseline.peakHeapBytes.median / (1024 * 1024)).toFixed(1)} MB, median of ${String(baseline.peakHeapBytes.samples)}`;
    case 'external-requests':
      return String(baseline.externalRequests);
    case 'csp-violations':
      return String(baseline.cspViolations);
    case 'served-document':
      return `${(baseline.parsedBytes.documentBytes / 1024).toFixed(1)} KB`;
    default:
      return null;
  }
}

/**
 * The zero language reading of the measured page, derived rather than recorded.
 *
 * Every field is arithmetic over the committed record and `PAGE_SAMPLE_LANGUAGE_MEASUREMENT`.
 * Nothing here is typed by hand anywhere, which is the point of the shape.
 */
export interface ZeroSamplePage {
  /** Document bytes with every drawn language off, section and server drawn block still there. */
  readonly documentBytes: number;
  /** That document plus the recorded stylesheet and bundle, which is what `page-bytes` counts. */
  readonly pageBytes: number;
  /** The ceiling the current one replaced, which the overrun is stated against. */
  readonly replacedCapBytes: number;
  /** How far the zero language page is over that ceiling. */
  readonly overrunBytes: number;
  /**
   * The same page with the one server drawn code block off as well.
   *
   * A LOWER BOUND AND LABELLED AS ONE. The harness has no instrument for taking the section chrome
   * off, so this is as light as the page can be shown to get rather than a second measurement, and
   * a figure presented as measured when it is bounded is the class of defect this file is full of.
   */
  readonly withoutServedBlockPageBytes: number;
  /** How far even that page is over the replaced ceiling. */
  readonly withoutServedBlockOverrunBytes: number;
}

/** The derivation, or the reason it could not be made. */
export type ZeroSampleDerivation =
  | { readonly determined: true; readonly figures: ZeroSamplePage }
  | { readonly determined: false; readonly reason: string };

/**
 * The zero language reading, derived from the committed record and the recorded language cost.
 *
 * IT REFUSES RATHER THAN ANSWERING ACROSS TWO TREES. The language costs were measured on one
 * commit and the three columns on another, and subtracting one from the other would produce a
 * confident number about a page that never existed. That is exactly how the reading this replaces
 * went stale: it was taken when the JS column stood at 112,151 and was still being quoted after the
 * column moved to 112,644. A check that cannot determine a fact says so and never defaults to the
 * answer that means success.
 *
 * @param baseline - The committed browser record
 * @returns The derived figures, or why they could not be derived
 */
export function zeroSamplePage(baseline: BrowserBaseline): ZeroSampleDerivation {
  const measurement = PAGE_SAMPLE_LANGUAGE_MEASUREMENT;

  if (baseline.commit !== measurement.commit) {
    return {
      determined: false,
      reason:
        `the browser record was taken at ${baseline.commit} and the language costs in ` +
        `PAGE_SAMPLE_LANGUAGE_MEASUREMENT at ${measurement.commit}, so the zero language reading ` +
        `is UNDETERMINED rather than stale: re-run tools/browser-budget/dist/measure-languages.js ` +
        `on the recorded tree and put its two figures in the constant`,
    };
  }

  const documentBytes = baseline.parsedBytes.documentBytes - measurement.allDrawnDocumentBytes;
  const pageBytes = documentBytes + baseline.parsedBytes.cssBytes + baseline.parsedBytes.jsBytes;
  const withoutServedBlockPageBytes = pageBytes - measurement.servedCodeBlockBytes;

  return {
    determined: true,
    figures: {
      documentBytes,
      pageBytes,
      replacedCapBytes: measurement.replacedPageBytesCap,
      overrunBytes: pageBytes - measurement.replacedPageBytesCap,
      withoutServedBlockPageBytes,
      withoutServedBlockOverrunBytes:
        withoutServedBlockPageBytes - measurement.replacedPageBytesCap,
    },
  };
}

/**
 * Whether a text states one whole number, whichever way it separates thousands.
 *
 * THREE SPELLINGS AND ONE REFUSAL. The two documents this reads write thousands differently, so
 * `216,114`, `216 114` and `216114` all count. What does not count is a digit group that touches
 * another one: `40 876 216 114` could be read as two numbers or as one, and a check that guessed
 * would either miss a stale figure or invent a present one. It matches neither, so an ambiguous
 * run reports the figure as unstated, which fails loudly instead of passing quietly.
 *
 * MY OWN CASE CAUGHT THIS. The first edition matched every separated run greedily and read
 * `40 876 216 114` as one eleven digit number, which is the same class of defect as the figures
 * this file exists to keep honest: an instrument that reports confidently on input it cannot parse.
 *
 * @param text - The prose to read
 * @param value - The number to look for
 * @returns Whether the text states it unambiguously
 */
export function statesNumber(text: string, value: number): boolean {
  const digits = String(value);
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/gu, '#');
  const spellings = [digits, grouped.replace(/#/gu, ','), grouped.replace(/#/gu, ' ')];

  return [...new Set(spellings)].some((spelling) =>
    new RegExp(`(?<!\\d)(?<!\\d[,. ])${spelling}(?!\\d)(?![,. ]\\d)`, 'u').test(text),
  );
}

/** One figure a prose home has to state, and what a reader should do when it does not. */
export interface RequiredFigure {
  /** What the figure is, as a noun phrase, for the message. */
  readonly what: string;
  readonly value: number;
  /** How good this figure is and what holds it, named in the failure. Optional. */
  readonly heldBy?: string;
}

/**
 * The figures a text is supposed to state, checked against what it actually states.
 *
 * PRESENCE IS THE WHOLE CHECK AND IT IS ENOUGH FOR THE DEFECT. A copy that has gone stale states
 * the old figure and not the new one, so the new one is missing and this reports it. It does not
 * complain about a superseded figure that a paragraph deliberately keeps beside the correction,
 * which is what the files here all do.
 *
 * ONE MECHANISM AND NOT THREE. Both callers below walk a prose region for a list of numbers that
 * something else derived, so they share this rather than each growing a copy of the same loop: a
 * second copy would be the very thing the derived figures were brought under a runner to stop.
 *
 * @param label - Which text this is, for the message
 * @param text - The text
 * @param required - What the text has to state
 * @param source - What produced these figures, named so a reader knows what to re-run
 * @returns One message per figure the text does not state
 */
export function statedFigureIssues(
  label: string,
  text: string,
  required: readonly RequiredFigure[],
  source: string,
): string[] {
  return required
    .filter((figure) => !statesNumber(text, figure.value))
    .map(
      (figure) =>
        `${label} does not state ${figure.what}, ${String(figure.value)}, which the derivation ` +
        `over ${source} produces. A figure written by hand that the derivation no longer agrees ` +
        `with is the defect this check exists for` +
        (figure.heldBy === undefined ? '' : `. ${figure.heldBy}`),
    );
}

/**
 * The zero language figures a text is supposed to state, checked against what it states.
 *
 * @param label - Which text this is, for the message
 * @param text - The text
 * @param figures - What the derivation produced
 * @returns One message per derived figure the text does not state
 */
export function zeroSampleFigureIssues(
  label: string,
  text: string,
  figures: ZeroSamplePage,
): string[] {
  const required: readonly RequiredFigure[] = [
    { what: 'the zero language document column', value: figures.documentBytes },
    { what: 'the zero language page total', value: figures.pageBytes },
    { what: 'the replaced ceiling', value: figures.replacedCapBytes },
    { what: 'the overrun over it', value: figures.overrunBytes },
    {
      what: 'the bound with the server drawn block off',
      value: figures.withoutServedBlockPageBytes,
    },
    { what: 'the overrun of that bound', value: figures.withoutServedBlockOverrunBytes },
    {
      what: 'the cost of the drawn languages',
      value: PAGE_SAMPLE_LANGUAGE_MEASUREMENT.allDrawnDocumentBytes,
    },
    {
      what: 'the server drawn code block',
      value: PAGE_SAMPLE_LANGUAGE_MEASUREMENT.servedCodeBlockBytes,
    },
  ];

  return statedFigureIssues(
    label,
    text,
    required,
    `${BROWSER_BASELINE_FILE} and PAGE_SAMPLE_LANGUAGE_MEASUREMENT`,
  );
}

/**
 * How good one page figure is, which is a different question from where it is written.
 *
 * `measurable` means an instrument in this repository takes the same quantity again off a built
 * tree, so the recorded column is compared with that instrument rather than believed. `recorded`
 * means the browser study on its named machine is the only instrument there is, so the figure is
 * as good as that run and no better. THE TWO ARE NOT INTERCHANGEABLE AND MUST NOT BE PRINTED AS
 * ONE: presenting a recorded figure as a derived one is how a number nobody can re-take comes to
 * read as a number somebody checked.
 */
export type PageFigureStanding = 'measurable' | 'recorded';

/** One of the `page-bytes` figures, with its standing attached rather than assumed. */
export interface PageFigure extends RequiredFigure {
  readonly standing: PageFigureStanding;
  /** Required here: a figure without its standing named is the thing this type exists against. */
  readonly heldBy: string;
}

/**
 * The `page-bytes` columns, their sum and the headroom, derived from the record and the ceiling.
 *
 * NOTHING HERE IS TYPED BY HAND, WHICH IS THE WHOLE OF THE CHANGE. Every one of these five lived
 * as a literal in the SPEC 20 row, in the `BROWSER_CEILINGS` comment and in the paragraphs beside
 * them, so re-recording `baseline.json` moved all five and left every prose home to be corrected
 * by hand, silently. That is how nine hand written figures in a row went stale.
 *
 * THE HEADROOM GOES NEGATIVE WHEN THE RECORD IS OVER THE CEILING, and that is left alone rather
 * than clamped. A record over its ceiling is `checkCeilings`'s finding first, and its prose has to
 * be rewritten in either case, so the honest reading of a negative headroom is that no paragraph
 * states it and every home is red.
 *
 * @param baseline - The committed browser record
 * @returns The five figures, each carrying whether an instrument can take it again
 */
export function pageBytesFigures(baseline: BrowserBaseline): readonly PageFigure[] {
  const bytes = baseline.parsedBytes;
  const total = pageBytesOf(bytes);

  return [
    {
      what: 'the document column',
      value: bytes.documentBytes,
      standing: 'recorded',
      heldBy:
        'RECORDED: it comes from the browser study on its named machine and nothing here can ' +
        'take it again, so what holds it is that it is typed in no prose home at all',
    },
    {
      what: 'the stylesheet column',
      value: bytes.cssBytes,
      standing: 'measurable',
      heldBy:
        'MEASURABLE: it is `theme-css-raw` of the published form byte for byte, which this ' +
        'repository weighs off a built tree, so the record is held against that instrument',
    },
    {
      what: 'the bundle column',
      value: bytes.jsBytes,
      standing: 'measurable',
      heldBy:
        'MEASURABLE: it is `client-js-raw` of the published form byte for byte, which this ' +
        'repository weighs off a built tree, so the record is held against that instrument',
    },
    {
      what: 'the page total',
      value: total,
      standing: 'recorded',
      heldBy:
        'RECORDED: it is the sum of the three columns and one of them comes from the study, so ' +
        'the sum is as good as that run and no better however measurable the other two are',
    },
    {
      what: 'the headroom under the ceiling in force',
      value: BROWSER_CEILINGS.pageBytes - total,
      standing: 'recorded',
      heldBy:
        'RECORDED: arithmetic over the live ceiling and a recorded total, so it moves when either ' +
        'moves and belongs in neither prose home as a literal',
    },
  ];
}

/**
 * The `page-bytes` figures a text is supposed to state, checked against what it states.
 *
 * @param label - Which text this is, for the message
 * @param text - The text
 * @param baseline - The committed browser record the figures are derived from
 * @returns One message per figure the text does not state
 */
export function pageBytesFigureIssues(
  label: string,
  text: string,
  baseline: BrowserBaseline,
): string[] {
  return statedFigureIssues(
    label,
    text,
    pageBytesFigures(baseline),
    `${BROWSER_BASELINE_FILE} and the BROWSER_CEILINGS.pageBytes in force`,
  );
}
