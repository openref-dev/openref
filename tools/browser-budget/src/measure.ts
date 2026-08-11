/**
 * One measurement of one page in a real browser.
 *
 * Four SPEC 19 and SPEC 20 claims come out of the same navigation, because they are four
 * properties of one page load and measuring them separately would measure four different
 * loads:
 *
 * - TTI under a CPU throttle, SPEC 20
 * - peak client memory, SPEC 20
 * - external network requests, SPEC 19.4 and SPEC 20
 * - strict CSP with no `unsafe-inline`, SPEC 19.2, enforced by the browser rather than scanned
 *
 * WHAT TTI MEANS HERE, stated because a metric nobody defined is a metric nobody can compare.
 * It is the moment the reader can act on the page, computed as the later of two things: the
 * end of `DOMContentLoaded`, which is after the deferred module script has hydrated, and the
 * end of the last long task the page ran. Nothing on this page runs after hydration, so the
 * thread is idle from that instant. This is deliberately not Lighthouse's TTI, whose five
 * second quiet window is longer than the whole budget it would be judging.
 *
 * IT IS MEASURED FROM `responseStart`, NOT FROM NAVIGATION START, and that is not a
 * convenience. The time before the first byte is the server rendering the page, which SPEC 20
 * budgets separately at two seconds per hash and which a reader pays once for a whole
 * deployment rather than once per visit. Counting it here would put one budget inside another
 * and would make the client figure move whenever the render cache was cold. Everything after
 * the first byte is the client's: the rest of the document, the stylesheets, the bundle, the
 * parse and the hydration.
 *
 * AND SINCE 2026-08-10, TTI IS NO LONGER THE THING THIS IS FOR. Three studies of identical
 * bytes, on one runner image and one Chrome, measured 213.9, 148.2 and 196.0 ms on three
 * processors of a pool that swaps them without saying so. Elapsed time on such machinery cannot
 * resolve a 150 ms ceiling, so SPEC 20 replaces what is checked with what the page costs rather
 * than how long it takes, and this file measures three more things beside the clock:
 *
 * - main thread task time, and the split into script, style recalculation and layout. Time
 *   spent rather than time elapsed: nothing the renderer waits for is in it
 * - the count of main thread tasks over 50 ms, which is what a reader feels as a stall
 * - the bytes the page parses and compiles, split by CSS and JS, which do not move with a
 *   processor at all because they are a count of bytes
 *
 * WHAT THE INSTRUMENT CANNOT DO, stated rather than glossed. The maintainer asked for task time
 * between `responseEnd` and `domInteractive`. `Performance.getMetrics` is a cumulative counter
 * with no way to read it at a navigation timing boundary, and nothing in the page can see a task
 * shorter than 50 ms, so what is measured is the whole of the load rather than one phase of it.
 * That is the wider quantity and it is also the safer one: a phase boundary on this page already
 * carried a wrong diagnosis once, in session 15, when `parseMs` was read as parsing the document
 * and moved by five percent when the document shrank by eighty five.
 */

import { applyVerifiedThrottle, THROTTLE_RATE, type ThrottleVerification } from './throttle.js';
import type { Browser, CDPSession, ConsoleMessage, Page, Request } from 'playwright-core';

/** A request the page made. */
export interface RequestRecord {
  readonly url: string;
  readonly resourceType: string;
  /** True when the request went somewhere other than the page's own origin. */
  readonly external: boolean;
}

/** A policy violation the browser reported. */
export interface CspViolationRecord {
  readonly directive: string;
  readonly blockedUri: string;
  readonly source: 'event' | 'console';
}

/**
 * The renderer's own counters, in seconds, exactly as `Performance.getMetrics` reports them.
 *
 * Kept in the browser's units up to the one place they are converted, so a factor of a thousand
 * cannot be applied twice or not at all without the conversion being visible.
 */
export interface RendererCounters {
  /** Total time the main thread spent inside tasks. Waiting is not a task. */
  readonly taskSeconds: number;
  readonly scriptSeconds: number;
  readonly recalcStyleSeconds: number;
  readonly layoutSeconds: number;
  /** Task time that is none of the three above: parsing, compiling, painting, event handling. */
  readonly otherSeconds: number;
}

/** What the main thread actually did over one page load, in milliseconds. */
export interface MainThreadWork {
  readonly taskMs: number;
  readonly scriptMs: number;
  readonly recalcStyleMs: number;
  readonly layoutMs: number;
  readonly otherMs: number;
  /**
   * Whether the navigation stayed in the renderer the throttle calibration ran in.
   *
   * THE CALIBRATION IS HUNDREDS OF MILLISECONDS OF DELIBERATE BUSY WORK, so a counter that
   * carried it would be measuring the measurer. Chrome swaps renderer process between
   * `about:blank` and the fixture origin today, which resets the counters, and the two cases are
   * told apart rather than assumed: a counter that went down was reset and reads page only, a
   * counter that went up is shared and the difference is the page's. Recorded per run so that a
   * change to Chrome's process model shows up as a flipped flag instead of as a figure that
   * quietly gained the calibration.
   */
  readonly rendererReused: boolean;
}

/**
 * What the page hands the main thread to parse and compile, split by kind.
 *
 * THE ONLY QUANTITY HERE THAT IS THE SAME ON EVERY MACHINE. It is a count of bytes, so it has no
 * spread across processors at all, which is what SPEC 20 wants from a budget after three studies
 * of one page disagreed by a third of its ceiling.
 */
export interface ParsedBytes {
  /** Decoded bytes of the document itself. */
  readonly documentBytes: number;
  readonly cssBytes: number;
  readonly jsBytes: number;
  /** Fonts, images and anything else, which the main thread does not parse as source. */
  readonly otherBytes: number;
}

/** Everything one navigation produced. */
export interface PageMeasurement {
  readonly url: string;
  /** Milliseconds from `responseStart`, per the definition at the top of this file. */
  readonly ttiMs: number;
  /** What the server took before the first byte, for context. Not part of the client budget. */
  readonly serverMs: number;
  readonly domContentLoadedMs: number;
  /** Where the time went, so a figure that is too high says what to look at. */
  readonly breakdown: TtiBreakdown;
  readonly longTaskCount: number;
  /** Milliseconds spent inside those tasks, so a count of one says how bad the one was. */
  readonly longTaskTotalMs: number;
  readonly lastLongTaskEndMs: number;
  /** What the main thread did, which is the quantity SPEC 20 moves to from elapsed time. */
  readonly work: MainThreadWork;
  /** What the page gave the main thread to parse and compile. */
  readonly parsedBytes: ParsedBytes;
  /**
   * Every subresource the page fetched, with the browser's own timings.
   *
   * IT IS HERE BECAUSE THE PHASE NAMES LIED ONCE. `parseMs` is `responseEnd` to
   * `domInteractive` and reads as "parsing the document", and on this page it is dominated by
   * whatever the parser waits for rather than by the markup. Cutting the served document from
   * 192 KB to 30 KB moved it by five percent, which is how that reading was caught. A figure
   * over budget has to say what to look at, and a phase boundary is not enough.
   */
  readonly resources: readonly ResourceRecord[];
  /** First contentful paint, or 0 when the browser reported none. */
  readonly firstPaintMs: number;
  /** Highest heap seen, in bytes. Zero when heap sampling was not asked for. */
  readonly peakHeapBytes: number;
  readonly heapSamples: number;
  readonly requests: readonly RequestRecord[];
  readonly cspViolations: readonly CspViolationRecord[];
  /** For each global `MeasureOptions.globals` named, whether the page set it. */
  readonly globals: Readonly<Record<string, boolean>>;
  /** Absent when the navigation ran unthrottled. */
  readonly throttle?: ThrottleVerification;
}

/** How one measurement is varied. */
export interface MeasureOptions {
  readonly url: string;
  /** CPU slowdown to apply, or 1 for none. Verified before the page is opened. */
  readonly throttleRate?: number;
  /**
   * Interval for the in page heap sampler, or absent for no sampling.
   *
   * OFF BY DEFAULT AND OFF FOR EVERY TTI RUN. A repeating timer is work the page would not
   * otherwise do, and a budget measured with the measurement running inside it is measuring
   * itself. The two budgets are taken on two documents anyway, so nothing is lost.
   */
  readonly heapSampleMs?: number;
  /**
   * Rewrites the served HTML on its way into the browser.
   *
   * This is how a plant reaches the page without the fixture growing a hole. The response is
   * fetched from the fixture and refilled with the same headers, so the policy the browser
   * enforces is still the one the server sent, nonce included.
   */
  readonly transformHtml?: (html: string) => string;
  /** How long the main thread must stay quiet before the page is called settled. */
  readonly quietMs?: number;
  /**
   * Globals to read back after the load, reported as set or not set.
   *
   * It exists for one claim a violation report cannot make on its own: that a block the browser
   * reported was a block the browser performed. A planted inline script writes a global, and a
   * violation beside a global that is set would mean the report was about nothing.
   */
  readonly globals?: readonly string[];
}

/** One subresource the page fetched, as the browser timed it. */
export interface ResourceRecord {
  readonly name: string;
  readonly initiatorType: string;
  /** Milliseconds from navigation start to the moment it was asked for. */
  readonly startMs: number;
  /** Milliseconds from navigation start to the moment the last byte arrived. */
  readonly endMs: number;
  readonly encodedBytes: number;
  readonly decodedBytes: number;
}

/** What the page collects for itself, read back after the load. */
interface PageTimings {
  readonly responseStartMs: number;
  readonly requestStartMs: number;
  readonly responseEndMs: number;
  readonly domInteractiveMs: number;
  readonly domContentLoadedMs: number;
  readonly longTasks: readonly { readonly startTime: number; readonly duration: number }[];
  readonly violations: readonly { readonly directive: string; readonly blockedUri: string }[];
  readonly heapSamples: readonly number[];
  readonly resources: readonly ResourceRecord[];
  readonly firstPaintMs: number;
  readonly documentBytes: number;
}

/**
 * Where the time between the first byte and an interactive page goes.
 *
 * A single figure says a page is too slow and says nothing about what to do, so the phases are
 * reported beside it. They are the browser's own boundaries rather than a decomposition of our
 * own making: the document arriving, the document parsing, and everything the deferred module
 * script does, which on this page is the bundle parsing and the hydration.
 */
export interface TtiBreakdown {
  /** First byte to last byte of the document. */
  readonly transferMs: number;
  /** Last byte to `domInteractive`: parsing the markup. */
  readonly parseMs: number;
  /** `domInteractive` to `DOMContentLoaded`: fetching and running the deferred module. */
  readonly scriptMs: number;
}

/**
 * The navigation timing fields this file reads.
 *
 * Declared here rather than reached for as `PerformanceNavigationTiming`, because that type
 * comes from the DOM library and this file is compiled in the Node program. T011 scoped DOM
 * types to `src/browser` and the integration suite for the same reason, and widening the
 * program to name three fields would put `document` back within reach of everything in
 * `tools`.
 */
interface NavigationTimingLike {
  readonly requestStart: number;
  readonly responseStart: number;
  readonly responseEnd: number;
  readonly domInteractive: number;
  readonly domContentLoadedEventEnd: number;
  readonly decodedBodySize: number;
}

/**
 * The main thread work of one page load, from the counters read either side of the navigation.
 *
 * @param before - Counters read after the throttle was verified and before the navigation
 * @param after - Counters read once the page had settled
 * @returns The work, with `rendererReused` saying which of the two readings it came from
 */
export function mainThreadWorkOf(
  before: RendererCounters,
  after: RendererCounters,
): MainThreadWork {
  // A COUNTER THAT WENT DOWN WAS RESET, which is a new renderer process, and the `after` reading
  // is then the page's own work with nothing of the calibration in it. A counter that went up is
  // the same renderer counting on, and the difference is the page's. Deciding on the total
  // rather than per field, so the five figures always describe one page load rather than a mix.
  const reused = after.taskSeconds >= before.taskSeconds;
  const of = (key: keyof RendererCounters): number =>
    (reused ? after[key] - before[key] : after[key]) * 1000;

  return {
    taskMs: of('taskSeconds'),
    scriptMs: of('scriptSeconds'),
    recalcStyleMs: of('recalcStyleSeconds'),
    layoutMs: of('layoutSeconds'),
    otherMs: of('otherSeconds'),
    rendererReused: reused,
  };
}

/** The last extension of a path, which is what decides how the main thread treats the bytes. */
const EXTENSION_PATTERN = /\.([a-z0-9]+)$/i;

/** What each kind of resource counts as. Anything unlisted is other. */
const KIND_BY_EXTENSION: Readonly<Record<string, 'css' | 'js'>> = {
  css: 'css',
  js: 'js',
  mjs: 'js',
  cjs: 'js',
};

/** What each initiator counts as, for a resource served with no extension at all. */
const KIND_BY_INITIATOR: Readonly<Record<string, 'css' | 'js'>> = {
  link: 'css',
  script: 'js',
};

/**
 * Splits what the page fetched into what the main thread parses as source and what it does not.
 *
 * CLASSIFIED BY THE EXTENSION FIRST AND THE INITIATOR ONLY WHEN THERE IS NONE. Assets are served
 * under names carrying a digest, and the digest sits before the extension rather than replacing
 * it, so the extension is the reliable half. The initiator alone would be wrong in a way that
 * flatters the CSS figure: a preloaded font is fetched by a `link` too, and counting a woff2 as
 * a stylesheet would put 45 KB the main thread never parses into the quantity being budgeted.
 * Anything neither rule names is counted as other rather than dropped, so every byte the page
 * fetched appears in exactly one column.
 *
 * @param documentBytes - Decoded bytes of the document itself, which is not a subresource
 * @param resources - What the page fetched
 * @returns The split
 */
export function parsedBytesOf(
  documentBytes: number,
  resources: readonly ResourceRecord[],
): ParsedBytes {
  let cssBytes = 0;
  let jsBytes = 0;
  let otherBytes = 0;

  for (const resource of resources) {
    const extension = EXTENSION_PATTERN.exec(pathOf(resource.name))?.[1]?.toLowerCase();
    const kind =
      extension === undefined
        ? KIND_BY_INITIATOR[resource.initiatorType]
        : KIND_BY_EXTENSION[extension];

    if (kind === 'css') cssBytes += resource.decodedBytes;
    else if (kind === 'js') jsBytes += resource.decodedBytes;
    else otherBytes += resource.decodedBytes;
  }

  return { documentBytes, cssBytes, jsBytes, otherBytes };
}

/**
 * The path of a resource url, without the origin, which changes per run.
 *
 * @param name - Url as the browser recorded it
 * @returns The path, or the whole string when it is not a url
 */
function pathOf(name: string): string {
  try {
    return new URL(name).pathname;
  } catch {
    return name;
  }
}

/**
 * The script the page carries, installed before anything of the page's own runs.
 *
 * Injected through CDP rather than written into the document, so it neither needs a nonce nor
 * changes what the policy is asked to authorize. A `<script>` added to the page in order to
 * observe the page would be the one inline script this project exists to avoid.
 *
 * @param heapSampleMs - Sampling interval, or 0 for no heap sampler
 * @returns The script source
 */
function observerScript(heapSampleMs: number): string {
  return `
  globalThis.__openrefLongTasks = [];
  globalThis.__openrefCspViolations = [];
  globalThis.__openrefHeapSamples = [];

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        globalThis.__openrefLongTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    globalThis.__openrefLongTaskObserverFailed = true;
  }

  addEventListener('securitypolicyviolation', (event) => {
    globalThis.__openrefCspViolations.push({
      directive: event.effectiveDirective || event.violatedDirective,
      blockedUri: event.blockedURI,
    });
  });

  if (${String(heapSampleMs)} > 0) {
    const sample = () => {
      const memory = performance.memory;
      if (memory) globalThis.__openrefHeapSamples.push(memory.usedJSHeapSize);
    };
    sample();
    setInterval(sample, ${String(heapSampleMs)});
  }
`;
}

/**
 * Measures one page.
 *
 * @param browser - A launched Chrome
 * @param options - Which page, and how
 * @returns Everything the navigation produced
 * @throws Error when the throttle did not take, or when the page reports no navigation timing
 */
export async function measurePage(
  browser: Browser,
  options: MeasureOptions,
): Promise<PageMeasurement> {
  const quietMs = options.quietMs ?? 300;
  const heapSampleMs = options.heapSampleMs ?? 0;
  const rate = options.throttleRate ?? THROTTLE_RATE;

  const context = await browser.newContext();
  const page = await context.newPage();
  const session = await context.newCDPSession(page);

  const requests: RequestRecord[] = [];
  const consoleViolations: CspViolationRecord[] = [];
  const origin = new URL(options.url).origin;

  page.on('request', (request: Request) => {
    requests.push({
      url: request.url(),
      resourceType: request.resourceType(),
      external: !request.url().startsWith(origin) && !request.url().startsWith('data:'),
    });
  });

  // A CROSS CHECK ON THE EVENT, NOT A SUBSTITUTE FOR IT. A blocked subresource fires
  // `securitypolicyviolation` in the document and also logs to the console; reading both and
  // taking the union means a future Chrome that stops doing one of them still reports.
  page.on('console', (message: ConsoleMessage) => {
    const text = message.text();
    if (!/Content Security Policy/i.test(text)) return;
    consoleViolations.push({
      directive: /directive[: ]+"?([\w-]+)/i.exec(text)?.[1] ?? 'unknown',
      blockedUri: text,
      source: 'console',
    });
  });

  await page.addInitScript(observerScript(heapSampleMs));
  await session.send('Performance.enable', { timeDomain: 'timeTicks' });

  if (options.transformHtml !== undefined) {
    const transform = options.transformHtml;
    await page.route(options.url, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: transform(await response.text()) });
    });
  }

  let throttle: ThrottleVerification | undefined;
  if (rate > 1) {
    // ON A BLANK PAGE, BEFORE THE NAVIGATION. Calibrating inside the page under test would
    // contend with its own work and would time the loop against a busy main thread.
    throttle = await applyVerifiedThrottle(page, session, rate);
  }

  // AFTER THE CALIBRATION AND BEFORE THE NAVIGATION, which is the only moment this reading is
  // worth taking. The calibration is a busy loop by design, so a counter read before it would
  // hand the page several hundred milliseconds of the harness's own work.
  const countersBefore = await rendererCounters(session);

  try {
    const response = await page.goto(options.url, { waitUntil: 'load', timeout: 180_000 });

    // THE SUBJECT IS ASSERTED PRESENT BEFORE ANYTHING IS ASSERTED ABSENT, per SPEC 0. Six
    // security proofs of M0 measured a 404 for the length of a milestone: the routes had been
    // written out by hand beside a generated document and stopped existing, and a 404 page loads
    // no assets, so zero external requests and zero policy violations read exactly like a page
    // that behaves. The status is checked here rather than in each caller because every one of
    // them asks a question whose cheap answer is an error page.
    if (response === null) {
      throw new Error(`no response for ${options.url}, so nothing was measured`);
    }

    if (!response.ok()) {
      throw new Error(
        `${options.url} answered ${String(response.status())}. A page that failed to load asks ` +
          'for nothing and reports nothing, which is not a measurement and is not a pass',
      );
    }

    await settle(page, quietMs);

    const timings = await page.evaluate((): PageTimings => {
      // Node's `EntryType` does not name `navigation`, because Node has no navigations. The
      // call runs in the browser, so the browser's signature is the true one here.
      const timing = performance as unknown as {
        getEntriesByType(type: string): readonly NavigationTimingLike[];
      };
      const navigation = timing.getEntriesByType('navigation')[0];

      const globals = globalThis as unknown as {
        __openrefLongTasks?: { startTime: number; duration: number }[];
        __openrefCspViolations?: { directive: string; blockedUri: string }[];
        __openrefHeapSamples?: number[];
        __openrefLongTaskObserverFailed?: boolean;
      };

      if (globals.__openrefLongTaskObserverFailed === true) {
        throw new Error('this browser does not report long tasks, so TTI cannot be computed');
      }

      const resourceTimings = (
        performance as unknown as {
          getEntriesByType(type: string): readonly {
            name: string;
            initiatorType: string;
            startTime: number;
            responseEnd: number;
            encodedBodySize: number;
            decodedBodySize: number;
          }[];
        }
      ).getEntriesByType('resource');

      const paints = (
        performance as unknown as {
          getEntriesByType(type: string): readonly { name: string; startTime: number }[];
        }
      ).getEntriesByType('paint');

      return {
        resources: resourceTimings.map((entry) => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          startMs: entry.startTime,
          endMs: entry.responseEnd,
          encodedBytes: entry.encodedBodySize,
          decodedBytes: entry.decodedBodySize,
        })),
        firstPaintMs:
          paints.find((entry) => entry.name === 'first-contentful-paint')?.startTime ?? 0,
        documentBytes: navigation?.decodedBodySize ?? 0,
        requestStartMs: navigation?.requestStart ?? -1,
        responseStartMs: navigation?.responseStart ?? -1,
        responseEndMs: navigation?.responseEnd ?? -1,
        domInteractiveMs: navigation?.domInteractive ?? -1,
        domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? -1,
        longTasks: globals.__openrefLongTasks ?? [],
        violations: globals.__openrefCspViolations ?? [],
        heapSamples: globals.__openrefHeapSamples ?? [],
      };
    });

    if (timings.domContentLoadedMs < 0 || timings.responseStartMs < 0) {
      throw new Error(`no navigation timing entry for ${options.url}`);
    }

    const globals: Record<string, boolean> = {};
    for (const name of options.globals ?? []) {
      globals[name] = await page.evaluate(
        (key: string) => (globalThis as unknown as Record<string, unknown>)[key] !== undefined,
        name,
      );
    }

    if (heapSampleMs > 0 && timings.heapSamples.length === 0) {
      throw new Error(
        'the heap sampler produced nothing, so peak client memory would report zero. ' +
          'performance.memory is what it reads and this browser does not expose it.',
      );
    }

    const lastLongTaskEndMs = timings.longTasks.reduce(
      (latest, task) => Math.max(latest, task.startTime + task.duration),
      0,
    );

    const work = mainThreadWorkOf(countersBefore, await rendererCounters(session));

    // A COUNTER OF ZERO IS A BROKEN INSTRUMENT, NOT AN IDLE PAGE. This page compiles a hundred
    // kilobytes of JavaScript and hydrates a component tree, so a main thread that did no work
    // measured nothing. Left as a failure rather than a figure, for the reason the heap sampler
    // is: a budget nobody measured reads exactly like one that passed.
    if (work.taskMs <= 0) {
      throw new Error(
        'Performance.getMetrics reported no main thread task time for this page load, so the ' +
          'quantity SPEC 20 budgets was not measured. TaskDuration is what it reads.',
      );
    }

    return {
      url: options.url,
      ttiMs: Math.max(timings.domContentLoadedMs, lastLongTaskEndMs) - timings.responseStartMs,
      serverMs: timings.responseStartMs - timings.requestStartMs,
      domContentLoadedMs: timings.domContentLoadedMs,
      breakdown: {
        transferMs: timings.responseEndMs - timings.responseStartMs,
        parseMs: timings.domInteractiveMs - timings.responseEndMs,
        scriptMs: timings.domContentLoadedMs - timings.domInteractiveMs,
      },
      longTaskCount: timings.longTasks.length,
      longTaskTotalMs: timings.longTasks.reduce((total, task) => total + task.duration, 0),
      lastLongTaskEndMs,
      work,
      parsedBytes: parsedBytesOf(timings.documentBytes, timings.resources),
      resources: timings.resources,
      firstPaintMs: timings.firstPaintMs,
      peakHeapBytes: timings.heapSamples.reduce((peak, sample) => Math.max(peak, sample), 0),
      heapSamples: timings.heapSamples.length,
      requests,
      globals,
      cspViolations: [
        ...timings.violations.map((violation) => ({ ...violation, source: 'event' as const })),
        ...consoleViolations,
      ],
      ...(throttle === undefined ? {} : { throttle }),
    };
  } finally {
    await context.close();
  }
}

/**
 * Reads the renderer's own work counters over CDP.
 *
 * OVER CDP RATHER THAN FROM INSIDE THE PAGE, because nothing in the page can see a task shorter
 * than 50 ms: `PerformanceObserver` reports long tasks and long animation frames and neither is
 * the total. Reading it from the page would also mean running our own code inside the
 * measurement, which is the defect the heap sampler is kept off the TTI runs for.
 *
 * @param session - CDP session of the page
 * @returns The counters, in the seconds the protocol reports
 * @throws Error when the protocol reports no `TaskDuration`, because a missing counter defaulted
 *   to zero would read as a page that did no work
 */
async function rendererCounters(session: CDPSession): Promise<RendererCounters> {
  const response = (await session.send('Performance.getMetrics')) as {
    metrics: readonly { name: string; value: number }[];
  };
  const byName = new Map(response.metrics.map((metric) => [metric.name, metric.value]));

  if (!byName.has('TaskDuration')) {
    throw new Error(
      'Performance.getMetrics reports no TaskDuration, so main thread work cannot be measured ' +
        'in this browser. SPEC 20 budgets that quantity, so this is a failure and not a zero.',
    );
  }

  const of = (name: string): number => byName.get(name) ?? 0;

  return {
    taskSeconds: of('TaskDuration'),
    scriptSeconds: of('ScriptDuration'),
    recalcStyleSeconds: of('RecalcStyleDuration'),
    layoutSeconds: of('LayoutDuration'),
    otherSeconds: of('TaskOtherDuration'),
  };
}

/**
 * Waits until the page has run no long task for `quietMs`.
 *
 * Bounded, because a page that never goes quiet is a finding of its own rather than something
 * to wait out. Nothing on this page runs after hydration, so the wait is one interval in
 * practice.
 *
 * @param page - Page to watch
 * @param quietMs - How long the thread must stay idle
 */
async function settle(page: Page, quietMs: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  let previous = -1;

  for (;;) {
    const count = await page.evaluate(
      () =>
        (globalThis as unknown as { __openrefLongTasks?: unknown[] }).__openrefLongTasks?.length ??
        0,
    );

    if (count === previous) return;
    previous = count;

    if (Date.now() > deadline) return;
    await new Promise((resolve) => setTimeout(resolve, quietMs));
  }
}

/**
 * The requests that went somewhere other than the page's origin.
 *
 * @param measurement - What one navigation produced
 * @returns Every external request, in the order it was made
 */
export function externalRequestsOf(measurement: PageMeasurement): readonly RequestRecord[] {
  return measurement.requests.filter((request) => request.external);
}
