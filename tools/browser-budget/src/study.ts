/**
 * The measurement study: the same pages, many times, on one machine, with the spread recorded.
 *
 * A budget is only worth its cost if a regression fails it and noise does not, and nothing but
 * repetition can tell which is which. This produces the record a baseline is set from and the
 * record a gate later compares against, and it is the same code path in both cases, so a
 * committed figure and a checked figure are never two different measurements.
 */

import { nodeHref, type NavEntryModel } from '@openref/render';
import { launchChrome } from './chrome.js';
import { navigationHref } from '@openref/render';
import { bootFixture } from './fixture/boot.js';
import { FIXTURE_BASE_PATH } from './fixture/app.js';
import { currentEnvironment, type MeasurementEnvironment } from './environment.js';
import {
  externalRequestsOf,
  measurePage,
  type PageMeasurement,
  type ParsedBytes,
  type ResourceRecord,
} from './measure.js';
import { plantStallAndBytes } from './plants.js';
import { spreadOf, type Spread } from './statistics.js';
import { CHROME_ARGS } from './chrome.js';
import { THROTTLE_RATE } from './throttle.js';

/** The operation page of the generated document that TTI is measured on. */
export const TTI_PAGE = '/docs/get-resource-500';

/** Text that page must carry, so a changed identity scheme fails loudly. */
export const TTI_PAGE_MARKER = 'Resource 500';

/**
 * Fewest bytes a page of the memory document can be and still be one.
 *
 * A page of `stripe.yaml` is over a megabyte of markup. This is loose by two orders of
 * magnitude on purpose: it is not a size assertion, it is a guard against measuring the wrong
 * resource, which is a thing that has already happened once here.
 */
export const MEMORY_PAGE_MIN_BYTES = 50_000;

/**
 * How often the in page sampler reads the heap during the memory run.
 *
 * A SAMPLED PEAK IS A SAMPLED PEAK, and this is stated rather than glossed: an allocation
 * spike shorter than the interval, or one that happens while the main thread is inside a
 * single long task, is not seen. What is bounded here is the heap the page settles at plus
 * whatever transient the sampler catches, against a ceiling with two orders of magnitude of
 * room, so the resolution is not what decides the answer.
 */
export const HEAP_SAMPLE_MS = 25;

/** One subresource, as it behaved across the runs of a study. */
export interface ResourceSummary {
  /** Path of the resource, without the origin, which changes per run. */
  readonly path: string;
  readonly initiatorType: string;
  readonly decodedBytes: number;
  /** Median moment the last byte arrived, from navigation start. */
  readonly endMs: number;
  /** How many of the runs fetched it, so a conditional request is visible as one. */
  readonly runs: number;
}

/**
 * Summarises what the page fetched besides itself.
 *
 * A phase boundary says a page is slow between two events and never says what it was waiting
 * for. This does: every subresource, when its last byte arrived, and how big it was.
 *
 * @param runs - The measurements of one page
 * @returns One entry per distinct path, slowest last
 */
function resourceSummaries(runs: readonly PageMeasurement[]): ResourceSummary[] {
  const byPath = new Map<string, ResourceRecord[]>();

  for (const run of runs) {
    for (const resource of run.resources) {
      const path = new URL(resource.name).pathname;
      byPath.set(path, [...(byPath.get(path) ?? []), resource]);
    }
  }

  return [...byPath.entries()]
    .map(([path, records]) => ({
      path,
      initiatorType: records[0]?.initiatorType ?? '',
      decodedBytes: records[0]?.decodedBytes ?? 0,
      endMs: spreadOf(records.map((record) => record.endMs)).median,
      runs: records.length,
    }))
    .sort((left, right) => left.endMs - right.endMs);
}

/** The main thread quantities, each across the runs of one study. */
export interface WorkSpreads {
  /** Total main thread task time per page load. */
  readonly taskMs: Spread;
  readonly scriptMs: Spread;
  readonly recalcStyleMs: Spread;
  readonly layoutMs: Spread;
  readonly otherMs: Spread;
  readonly longTaskCount: Spread;
  readonly longTaskTotalMs: Spread;
  /**
   * Task time divided by what the same machine took over the calibration workload.
   *
   * NOT A QUANTITY SPEC 20 NAMES, and it is here because the decision the study feeds needs it.
   * If task time turns out to move with the processor as much as the clock does, the next
   * question is whether anything can be normalized against the machine, and session 17 already
   * observed that the throttle verification runs a fixed workload on every run and throws its
   * timing away after the ratio check. This keeps it: the page's work in units of a million
   * iterations of that loop, measured under the same throttle, so both the machine and the
   * throttle divide out. A column, not a budget, and it is labelled as one.
   */
  readonly calibratedWork: Spread;
  /**
   * Whether every run reported the renderer as reused, or every run as swapped.
   *
   * The two readings are both correct and they are not the same measurement, so a study that saw
   * both took its figures two different ways and says so rather than averaging them.
   */
  readonly rendererReusedConsistently: boolean;
}

/**
 * The main thread figures of a set of runs, with the calibration column derived per run.
 *
 * @param runs - Measurements of one page
 * @returns One spread per quantity
 */
function workSpreads(runs: readonly PageMeasurement[]): WorkSpreads {
  const reused = runs.map((run) => run.work.rendererReused);

  return {
    taskMs: spreadOf(runs.map((run) => run.work.taskMs)),
    scriptMs: spreadOf(runs.map((run) => run.work.scriptMs)),
    recalcStyleMs: spreadOf(runs.map((run) => run.work.recalcStyleMs)),
    layoutMs: spreadOf(runs.map((run) => run.work.layoutMs)),
    otherMs: spreadOf(runs.map((run) => run.work.otherMs)),
    longTaskCount: spreadOf(runs.map((run) => run.longTaskCount)),
    longTaskTotalMs: spreadOf(runs.map((run) => run.longTaskTotalMs)),
    calibratedWork: spreadOf(runs.map((run) => calibratedWorkOf(run))),
    rendererReusedConsistently: reused.every((value) => value === reused[0]),
  };
}

/**
 * One run's main thread work, in units of a million iterations of the calibration workload.
 *
 * @param run - One measurement
 * @returns The ratio, or 0 when the run carried no verified throttle to calibrate against
 */
export function calibratedWorkOf(run: PageMeasurement): number {
  const throttle = run.throttle;
  if (throttle === undefined || throttle.throttledMs <= 0 || throttle.iterations <= 0) return 0;

  // The throttled sample rather than the unthrottled one, because the page was measured under
  // the throttle too, so dividing by it takes the throttle out along with the machine.
  const msPerMillionIterations = (throttle.throttledMs * 1_000_000) / throttle.iterations;

  return run.work.taskMs / msPerMillionIterations;
}

/** Each byte column across the runs of one study. */
export interface ParsedByteSpreads {
  readonly documentBytes: Spread;
  readonly cssBytes: Spread;
  readonly jsBytes: Spread;
  readonly otherBytes: Spread;
}

/**
 * The byte split of a study, one spread per column.
 *
 * A SPREAD RATHER THAN ONE FIGURE AND A FLAG, which is what the first version of this was. The
 * same page serves the same bytes every time, so these columns should not move at all, and a
 * boolean saying that one of the four did move named neither which nor by how much. Measured
 * locally on the first run: the document, the CSS and the JS are identical across runs and the
 * fonts are not, because a face is fetched when the page needs a glyph from it and a run that
 * settled first has one entry fewer. That is a real difference between runs of the same page and
 * it belongs in the column it happened to, not in a flag over all four.
 *
 * @param runs - Measurements of one page
 * @returns One spread per column
 */
function parsedByteSpreads(runs: readonly PageMeasurement[]): ParsedByteSpreads {
  const column = (pick: (bytes: ParsedBytes) => number): Spread =>
    spreadOf(runs.map((run) => pick(run.parsedBytes)));

  return {
    documentBytes: column((bytes) => bytes.documentBytes),
    cssBytes: column((bytes) => bytes.cssBytes),
    jsBytes: column((bytes) => bytes.jsBytes),
    otherBytes: column((bytes) => bytes.otherBytes),
  };
}

/** How a study is varied. */
export interface StudyOptions {
  /** Throttled runs over the thousand node page. */
  readonly ttiRuns?: number;
  /** Unthrottled runs over the 6.4 MB document, which are slow and vary far less. */
  readonly memoryRuns?: number;
}

/** What one study produced. */
export interface StudyReport {
  readonly environment: MeasurementEnvironment;
  readonly browser: { readonly version: string; readonly major: number };
  readonly chromeArgs: readonly string[];
  readonly throttleRate: number;
  /** Measured slowdown per run, proving the throttle took every time rather than once. */
  readonly throttleRatios: readonly number[];
  readonly tti: Spread;
  /**
   * What the main thread did, which is what SPEC 20 moves to from elapsed time.
   *
   * REPORTED BESIDE TTI ON THE SAME RUNS, deliberately, and not in a study of its own. The
   * question these figures exist to answer is whether they are steadier than the clock across
   * processors, and two quantities measured on two sets of navigations could not answer it.
   */
  readonly work: WorkSpreads;
  /** What the page gave the main thread to parse and compile, which no processor changes. */
  readonly parsedBytes: ParsedByteSpreads;
  /** Where the time went, so a figure over budget says what to look at. */
  readonly ttiTransferMs: Spread;
  readonly ttiParseMs: Spread;
  readonly ttiScriptMs: Spread;
  readonly ttiRuns: readonly PageMeasurement[];
  /** Median first contentful paint, for context on what the reader sees and when. */
  readonly ttiFirstPaintMs: Spread;
  /** What the page fetched besides itself, summarised over the runs. */
  readonly ttiResources: readonly ResourceSummary[];
  readonly peakHeapBytes: Spread;
  readonly memoryRuns: readonly PageMeasurement[];
  /** Every request either page made to anything but its own origin. */
  readonly externalRequests: readonly string[];
  /** Every policy violation either page produced. */
  readonly cspViolations: readonly string[];
}

/**
 * Finds the first node page of a reference, through the routes the reference serves.
 *
 * IT USED TO READ THE LINKS OUT OF THE OVERVIEW MARKUP, and T012-R2 took those away: an
 * overview opens no group, so its sidebar carries group headers and no operation link at all.
 * The harness caught that itself, on the runner, by refusing to measure rather than measuring
 * something else, which is what it was built to do.
 *
 * It now asks the same navigation route the page asks, and builds the url with the same
 * function the page builds it with. Nothing about the identity rule or the link shape is
 * restated here; both live in packages that own them.
 *
 * @param baseUrl - Origin of the fixture
 * @returns An absolute url
 * @throws Error when the reference serves no node at all
 */
export async function firstNodePage(baseUrl: string): Promise<string> {
  const overview = await (await fetch(`${baseUrl}${FIXTURE_BASE_PATH}`)).text();
  const state = /<script type="application\/json" id="oref-state"[^>]*>([\s\S]*?)<\/script>/.exec(
    overview,
  )?.[1];

  if (state === undefined) {
    throw new Error(`the overview at ${baseUrl}${FIXTURE_BASE_PATH} carries no page state`);
  }

  const documentHash = (JSON.parse(state) as { documentHash?: unknown }).documentHash;
  if (typeof documentHash !== 'string') {
    throw new Error(
      'the page state carries no document hash, so the navigation cannot be asked for',
    );
  }

  const payload = (await (
    await fetch(`${baseUrl}${navigationHref(documentHash, FIXTURE_BASE_PATH)}`)
  ).json()) as { navigation?: readonly NavEntryModel[] };

  const firstNodeId = (function find(entries: readonly NavEntryModel[]): string | null {
    for (const entry of entries) {
      if (entry.nodeId !== null) return entry.nodeId;
      const inside = find(entry.children);
      if (inside !== null) return inside;
    }

    return null;
  })(payload.navigation ?? []);

  if (firstNodeId === null) {
    throw new Error(`the reference at ${baseUrl}${FIXTURE_BASE_PATH} navigates to no node`);
  }

  return `${baseUrl}${nodeHref(firstNodeId, FIXTURE_BASE_PATH)}`;
}

/**
 * Runs the study.
 *
 * @param options - How many runs of each
 * @returns The report
 * @throws Error when the browser cannot be launched, when the throttle does not take, or when
 *   the page measured is not the page intended
 */
export async function runStudy(options: StudyOptions = {}): Promise<StudyReport> {
  const ttiRuns = options.ttiRuns ?? 10;
  const memoryRuns = options.memoryRuns ?? 3;

  const chrome = await launchChrome();

  try {
    const large = await bootFixture('large');
    const ttiMeasurements: PageMeasurement[] = [];

    try {
      const url = `${large.url}${TTI_PAGE}`;
      const probe = await fetch(url);
      const markup = await probe.text();
      if (!markup.includes(TTI_PAGE_MARKER)) {
        throw new Error(
          `${url} does not carry "${TTI_PAGE_MARKER}", so the page being measured is not the ` +
            'thousand node operation page this budget is written about',
        );
      }

      for (let run = 0; run < ttiRuns; run += 1) {
        ttiMeasurements.push(
          await measurePage(chrome.browser, {
            url,
            throttleRate: THROTTLE_RATE,
            // TEMPORARY PLANT, REVERTED IN THE NEXT COMMIT. See `plantStallAndBytes`.
            transformHtml: plantStallAndBytes,
          }),
        );
      }
    } finally {
      await large.stop();
    }

    const memory = await bootFixture('memory');
    const memoryMeasurements: PageMeasurement[] = [];

    try {
      const url = await firstNodePage(memory.url);

      // WHAT CAME BACK HAS TO BE A NODE PAGE. The first version of `firstNodePage` returned a
      // stylesheet, and a stylesheet loads fast and costs nothing, so the memory budget passed
      // while measuring nothing. A page of the largest document in the corpus is large; one
      // that is not is the wrong page.
      const probe = await fetch(url);
      const markup = await probe.text();
      if (markup.length < MEMORY_PAGE_MIN_BYTES) {
        throw new Error(
          `${url} is ${String(markup.length)} bytes, which is too small to be a page of the ` +
            'document the memory budget is written about',
        );
      }

      for (let run = 0; run < memoryRuns; run += 1) {
        // UNTHROTTLED, because a heap is a heap at any clock speed and a throttle would only
        // make the run longer. SPEC 20 attaches the throttle to TTI and to nothing else.
        memoryMeasurements.push(
          await measurePage(chrome.browser, {
            url,
            throttleRate: 1,
            heapSampleMs: HEAP_SAMPLE_MS,
          }),
        );
      }
    } finally {
      await memory.stop();
    }

    const everyRun = [...ttiMeasurements, ...memoryMeasurements];

    return {
      work: workSpreads(ttiMeasurements),
      parsedBytes: parsedByteSpreads(ttiMeasurements),
      environment: currentEnvironment(),
      browser: { version: chrome.version, major: chrome.major },
      chromeArgs: CHROME_ARGS,
      throttleRate: THROTTLE_RATE,
      throttleRatios: ttiMeasurements.map((run) => run.throttle?.ratio ?? 0),
      tti: spreadOf(ttiMeasurements.map((run) => run.ttiMs)),
      ttiTransferMs: spreadOf(ttiMeasurements.map((run) => run.breakdown.transferMs)),
      ttiParseMs: spreadOf(ttiMeasurements.map((run) => run.breakdown.parseMs)),
      ttiScriptMs: spreadOf(ttiMeasurements.map((run) => run.breakdown.scriptMs)),
      ttiFirstPaintMs: spreadOf(ttiMeasurements.map((run) => run.firstPaintMs)),
      ttiResources: resourceSummaries(ttiMeasurements),
      ttiRuns: ttiMeasurements,
      peakHeapBytes: spreadOf(memoryMeasurements.map((run) => run.peakHeapBytes)),
      memoryRuns: memoryMeasurements,
      externalRequests: everyRun.flatMap((run) =>
        externalRequestsOf(run).map((request) => `${request.resourceType} ${request.url}`),
      ),
      cspViolations: everyRun.flatMap((run) =>
        run.cspViolations.map(
          (violation) =>
            `${violation.source}: ${violation.directive} blocked ${violation.blockedUri}`,
        ),
      ),
    };
  } finally {
    await chrome.close();
  }
}
