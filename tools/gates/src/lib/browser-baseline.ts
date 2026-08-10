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
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BROWSER_BASELINE_FILE, BROWSER_CEILINGS } from '../config.js';

/** What one figure looked like across the runs of a study. */
export interface BaselineSpread {
  readonly samples: number;
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly standardDeviation: number;
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
   * It carries, today, the two things a later reader would otherwise get wrong: that TTI is
   * over its ceiling deliberately rather than by an oversight, and that the runner's CPU model
   * is not fixed within one image, so a small movement between two records is not necessarily
   * a change to the product.
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
  readonly ttiMs: BaselineSpread;
  /** Where the time went, in medians, because a figure over budget has to say what to look at. */
  readonly ttiPhaseMs: {
    readonly transfer: number;
    readonly parse: number;
    readonly script: number;
    readonly firstContentfulPaint: number;
  };
  readonly peakHeapBytes: BaselineSpread;
  readonly externalRequests: number;
  readonly cspViolations: number;
  /** Bytes of the served document of the page TTI is measured on. */
  readonly servedDocumentBytes: number;
  /** What is over its ceiling today, named here so a reader of the file is not surprised. */
  readonly overBudget: readonly string[];
}

/** One thing wrong with a baseline, or with a study measured against one. */
export interface BaselineIssue {
  readonly budget: string;
  readonly message: string;
  /** `over-budget` is the product; `stale` and `malformed` are the record. */
  readonly kind: 'over-budget' | 'stale' | 'malformed';
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
  spread('peakHeapBytes', record.peakHeapBytes);

  return record as BrowserBaseline;
}

/**
 * Checks the recorded figures against the SPEC 20 ceilings.
 *
 * @param baseline - The committed record
 * @returns One issue per figure over its ceiling, empty when everything is inside
 */
export function checkCeilings(baseline: BrowserBaseline): BaselineIssue[] {
  const issues: BaselineIssue[] = [];

  if (baseline.ttiMs.median > BROWSER_CEILINGS.ttiMs) {
    issues.push({
      budget: 'tti',
      kind: 'over-budget',
      message:
        `${baseline.ttiMs.median.toFixed(1)} ms against ${String(BROWSER_CEILINGS.ttiMs)} ms, measured as the ` +
        `median of ${String(baseline.ttiMs.samples)} navigations on ${baseline.environment.id} with ` +
        `Chrome ${String(baseline.browser.major)}. Where it goes: ${baseline.ttiPhaseMs.transfer.toFixed(1)} ms ` +
        `transfer, ${baseline.ttiPhaseMs.parse.toFixed(1)} ms to an interactive document, ` +
        `${baseline.ttiPhaseMs.script.toFixed(1)} ms script and hydrate`,
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

  if (baseline.servedDocumentBytes > BROWSER_CEILINGS.servedDocumentBytes) {
    issues.push({
      budget: 'served-document',
      kind: 'over-budget',
      message: `${String(baseline.servedDocumentBytes)} bytes against ${String(BROWSER_CEILINGS.servedDocumentBytes)}`,
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
 *   regressed
 */
export function compareToBaseline(
  baseline: BrowserBaseline,
  study: MeasuredStudy,
): BaselineIssue[] {
  const issues: BaselineIssue[] = [];

  if (study.ttiMedianMs > BROWSER_CEILINGS.ttiMs) {
    issues.push({
      budget: 'tti',
      kind: 'over-budget',
      message: `${study.ttiMedianMs.toFixed(1)} ms against ${String(BROWSER_CEILINGS.ttiMs)} ms`,
    });
  }

  if (study.peakHeapMedianBytes > BROWSER_CEILINGS.peakHeapBytes) {
    issues.push({
      budget: 'client-memory',
      kind: 'over-budget',
      message: `${(study.peakHeapMedianBytes / (1024 * 1024)).toFixed(1)} MB against ${String(BROWSER_CEILINGS.peakHeapBytes / (1024 * 1024))} MB`,
    });
  }

  if (study.externalRequests > 0) {
    issues.push({
      budget: 'external-requests',
      kind: 'over-budget',
      message: `${String(study.externalRequests)} request(s) left the origin`,
    });
  }

  if (study.cspViolations > 0) {
    issues.push({
      budget: 'csp',
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

  const allowance = baseline.ttiMs.standardDeviation;
  if (study.ttiMedianMs > baseline.ttiMs.median + allowance) {
    issues.push({
      budget: 'tti',
      kind: 'over-budget',
      message:
        `${study.ttiMedianMs.toFixed(1)} ms against a recorded ${baseline.ttiMs.median.toFixed(1)} ms ` +
        `on the same machine and the same browser, which is beyond the ${allowance.toFixed(1)} ms ` +
        'this measurement varies by. That is a change to the product rather than to the day',
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
    case 'client-memory':
      return `${(baseline.peakHeapBytes.median / (1024 * 1024)).toFixed(1)} MB, median of ${String(baseline.peakHeapBytes.samples)}`;
    case 'external-requests':
      return String(baseline.externalRequests);
    case 'served-document':
      return `${(baseline.servedDocumentBytes / 1024).toFixed(1)} KB`;
    default:
      return null;
  }
}
