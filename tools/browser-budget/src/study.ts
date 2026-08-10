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
import { externalRequestsOf, measurePage, type PageMeasurement } from './measure.js';
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
  /** Where the time went, so a figure over budget says what to look at. */
  readonly ttiTransferMs: Spread;
  readonly ttiParseMs: Spread;
  readonly ttiScriptMs: Spread;
  readonly ttiRuns: readonly PageMeasurement[];
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
          await measurePage(chrome.browser, { url, throttleRate: THROTTLE_RATE }),
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
      environment: currentEnvironment(),
      browser: { version: chrome.version, major: chrome.major },
      chromeArgs: CHROME_ARGS,
      throttleRate: THROTTLE_RATE,
      throttleRatios: ttiMeasurements.map((run) => run.throttle?.ratio ?? 0),
      tti: spreadOf(ttiMeasurements.map((run) => run.ttiMs)),
      ttiTransferMs: spreadOf(ttiMeasurements.map((run) => run.breakdown.transferMs)),
      ttiParseMs: spreadOf(ttiMeasurements.map((run) => run.breakdown.parseMs)),
      ttiScriptMs: spreadOf(ttiMeasurements.map((run) => run.breakdown.scriptMs)),
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
