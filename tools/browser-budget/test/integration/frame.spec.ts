import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootExampleApp, EXAMPLE_BASE_PATH, launchChrome } from '../../src/index';
import type { LaunchedChrome, SpawnedServer } from '../../src/index';

/**
 * The frame of the page, measured, per finding F17 and the T023 amendment.
 *
 * WHAT WENT WRONG WAS A TOKEN DOING A JOB IT WAS NOT FOR. `--oref-layout-measure`, 78ch, bounds a
 * paragraph, and it was applied to the content column. On a 1600 px window that left the column
 * at about 1200 px, neither filling the window nor centred in it, with the sunken surface behind
 * the page bare to the right of it. The resolution is recorded in
 * `ai-docs/design/vernier/notes.md`: the third grid track is the frame, the column declares no
 * width of its own, and the measure stays on prose.
 *
 * THIS IS A BROWSER TEST AND CANNOT BE ANYTHING ELSE. A width is produced by layout, and jsdom
 * performs none: every box there is zero wide, so an assertion about a column filling a window is
 * green in jsdom on the defective arrangement and on the fixed one alike. That is the standing
 * rule about anything decided by the user agent rather than by the tree, and this is the fourth
 * thing it has caught.
 *
 * THE TOLERANCE IS A PIXEL AND NOT A PERCENTAGE. The three tracks are a fixed rail, a fixed
 * gutter and `minmax(0, 1fr)`, so they account for the window exactly; the only slack is
 * subpixel rounding in the engine's own layout.
 */

const TIMEOUT = 300_000;

/** Wide enough that a column bounded by a prose measure cannot reach the edge. */
const WIDE = { width: 1600, height: 900 };

let chrome: LaunchedChrome;
let app: SpawnedServer;

beforeAll(async () => {
  chrome = await launchChrome();
  app = await bootExampleApp();
}, TIMEOUT);

afterAll(async () => {
  await app.stop();
  await chrome.close();
}, TIMEOUT);

/** The boxes the frame is made of, measured on a real layout. */
async function frame(path: string): Promise<{
  window: number;
  rail: number;
  gutter: number;
  content: number;
  contentRight: number;
  columns: readonly number[];
}> {
  const context = await chrome.browser.newContext({ viewport: WIDE });
  const page = await context.newPage();

  await page.goto(`${app.url}${path}`, { waitUntil: 'load' });

  // THE DOM IS DESCRIBED HERE RATHER THAN IMPORTED. This package compiles against Node's
  // libraries, because everything else in it runs in Node; the callback below runs in the browser,
  // so the browser's shapes are declared where they are used, the way `measure.ts` does it.
  const measured = await page.evaluate(() => {
    interface BoxLike {
      readonly width: number;
      readonly left: number;
      readonly right: number;
    }
    interface ElementLike {
      getBoundingClientRect(): BoxLike;
    }
    const root = globalThis as unknown as {
      document: {
        querySelector(selector: string): ElementLike | null;
        querySelectorAll(selector: string): readonly ElementLike[];
      };
    };

    const box = (selector: string): BoxLike | null =>
      root.document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const layout = box('.oref-layout');
    const rail = box('.oref-sidebar');
    const content = box('.oref-content');
    const columns = [
      ...root.document.querySelectorAll('.oref-column-spec, .oref-column-runtime'),
    ].map((element) => element.getBoundingClientRect().width);

    return {
      window: layout?.width ?? 0,
      rail: rail?.width ?? 0,
      // The gutter is a grid track with no element in it, so it is what the two boxes leave.
      gutter: (content?.left ?? 0) - (rail?.right ?? 0),
      content: content?.width ?? 0,
      contentRight: content?.right ?? 0,
      columns,
    };
  });

  await context.close();

  return measured;
}

describe('the width of the content column', () => {
  it(
    'should account for the window together with the rail and the gutter',
    async () => {
      // Given a window far wider than any prose measure
      const measured = await frame(EXAMPLE_BASE_PATH);

      // When
      const accounted = measured.rail + measured.gutter + measured.content;

      // Then, the three tracks are the window, and nothing is left over on the right
      expect(measured.window).toBeGreaterThan(1000);
      expect(Math.abs(accounted - measured.window)).toBeLessThanOrEqual(1);
      expect(Math.abs(measured.contentRight - measured.window)).toBeLessThanOrEqual(1);
    },
    TIMEOUT,
  );

  it(
    'should be wider than the prose measure it used to be bounded by',
    async () => {
      // Given, the defect: 78ch of the interface font came out at about 1200 px on this window, so
      // a column that is still that wide is the one this test exists to refuse.
      const measured = await frame(EXAMPLE_BASE_PATH);

      // When
      const share = measured.content / measured.window;

      // Then
      expect(share).toBeGreaterThan(0.8);
    },
    TIMEOUT,
  );
});

/**
 * The gaps inside one runtime row, measured.
 *
 * The row draws a status, a title, a detail and a provenance mark, and it drew them with nothing
 * between any two of them: `429Too Many RequestsA rate limit of ... DRV`. A separator written
 * into the model's strings would be design living where a theme cannot reach it, so the gap is
 * the layout's, which means only a layout can report it. The title is a bare text node, so it is
 * measured through a range rather than through an element.
 *
 * @param path - Page to open
 * @returns The gap after the status, and the gap between two stacked contracts
 */
async function runtimeGaps(path: string): Promise<{ afterStatus: number; betweenItems: number }> {
  const context = await chrome.browser.newContext({ viewport: WIDE });
  const page = await context.newPage();

  await page.goto(`${app.url}${path}`, { waitUntil: 'load' });

  const measured = await page.evaluate(() => {
    interface BoxLike {
      readonly left: number;
      readonly right: number;
      readonly top: number;
      readonly bottom: number;
    }
    interface NodeLike {
      readonly nodeType: number;
      readonly textContent: string | null;
    }
    interface ElementLike extends NodeLike {
      readonly childNodes: Iterable<NodeLike>;
      getBoundingClientRect(): BoxLike;
      querySelector(selector: string): ElementLike | null;
    }
    interface RangeLike {
      selectNode(node: NodeLike): void;
      getBoundingClientRect(): BoxLike;
    }
    const root = globalThis as unknown as {
      document: {
        createRange(): RangeLike;
        querySelectorAll(selector: string): readonly ElementLike[];
      };
    };

    const items = [...root.document.querySelectorAll('.oref-section-runtime .oref-runtime-item')];
    const withStatus = items.filter((item) => item.querySelector('.oref-status') !== null);
    const first = withStatus[0];
    const status = first?.querySelector('.oref-status');
    const title = [...(first?.childNodes ?? [])].find(
      (node) => node.nodeType === 3 && (node.textContent ?? '').trim() !== '',
    );

    if (first === undefined || status === undefined || status === null || title === undefined) {
      return { afterStatus: -1, betweenItems: -1 };
    }

    const range = root.document.createRange();
    range.selectNode(title);

    const second = withStatus[1];

    return {
      afterStatus: range.getBoundingClientRect().left - status.getBoundingClientRect().right,
      betweenItems:
        second === undefined
          ? -1
          : second.getBoundingClientRect().top - first.getBoundingClientRect().bottom,
    };
  });

  await context.close();

  return measured;
}

describe('the runtime block of an operation page', () => {
  it(
    'should separate the parts of a fact and the contracts stacked under one label',
    async () => {
      // Given the example on an operation whose collectors produced error contracts
      const measured = await runtimeGaps(`${EXAMPLE_BASE_PATH}/get-orders`);

      // Then the status does not run into the title, and one contract does not run into the next.
      // Both were zero, which is what made the block read as a log line.
      expect(measured.afterStatus).toBeGreaterThanOrEqual(4);
      expect(measured.betweenItems).toBeGreaterThanOrEqual(4);
    },
    TIMEOUT,
  );
});

describe('the two columns of an operation page', () => {
  it(
    'should give the specification and the runtime equal width',
    async () => {
      // Given the example, whose collectors are registered, on an operation that carries facts.
      // vernier's component inventory names two equal columns as the one thing this direction does
      // that the other two do not.
      const measured = await frame(`${EXAMPLE_BASE_PATH}/get-orders`);

      // When
      const [spec, runtime] = measured.columns;

      // Then
      expect(measured.columns).toHaveLength(2);
      expect(spec).toBeGreaterThan(0);
      expect(Math.abs((spec ?? 0) - (runtime ?? 0))).toBeLessThanOrEqual(1);
    },
    TIMEOUT,
  );
});
