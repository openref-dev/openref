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
 */

import { applyVerifiedThrottle, THROTTLE_RATE, type ThrottleVerification } from './throttle.js';
import type { Browser, ConsoleMessage, Page, Request } from 'playwright-core';

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
  readonly lastLongTaskEndMs: number;
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

  try {
    await page.goto(options.url, { waitUntil: 'load', timeout: 180_000 });
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
      lastLongTaskEndMs,
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
