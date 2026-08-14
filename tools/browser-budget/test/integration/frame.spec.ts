import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootExampleApp, EXAMPLE_BASE_PATH, launchChrome } from '../../src/index';
import type { LaunchedChrome, SpawnedServer } from '../../src/index';
import type { Page } from 'playwright-core';

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
      ...root.document.querySelectorAll('.oref-parity-cell-spec, .oref-parity-cell-runtime'),
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
 * The gaps inside the response codes cell of the parity scale, measured.
 *
 * The defect this guards is the runtime block's own: parts of one value drawn with nothing
 * between any two of them, `429derived from runtimeDRV`, and stacked values running together.
 * A separator written into the model's strings would be design living where a theme cannot
 * reach it, so the gap is the layout's, which means only a layout can report it. The value's
 * text is a bare text node, so it is measured through a range rather than through an element.
 *
 * @param path - Page to open
 * @returns The gap between a value's text and its note, and the gap between two stacked values
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

    const items = [
      ...root.document.querySelectorAll('[data-oref-parity="response-codes"] .oref-runtime-item'),
    ];

    // The gap is measured where the text and its note share a line. A long note wraps under a
    // long sentence, which the design allows, and a wrapped note's left edge says nothing
    // about the separation this exists to hold.
    let afterStatus = -1;
    for (const item of items) {
      const note = item.querySelector('.oref-runtime-note');
      const title = [...item.childNodes].find(
        (node) => node.nodeType === 3 && (node.textContent ?? '').trim() !== '',
      );
      if (note === null || title === undefined) continue;

      const range = root.document.createRange();
      range.selectNode(title);
      const textBox = range.getBoundingClientRect();
      const noteBox = note.getBoundingClientRect();
      if (noteBox.top >= textBox.bottom) continue;

      afterStatus = noteBox.left - textBox.right;
      break;
    }

    const first = items[0];
    const second = items[1];

    return {
      afterStatus,
      betweenItems:
        first === undefined || second === undefined
          ? -1
          : second.getBoundingClientRect().top - first.getBoundingClientRect().bottom,
    };
  });

  await context.close();

  return measured;
}

describe('the runtime cell of a parity row', () => {
  it(
    'should separate the parts of a value and the values stacked in one cell',
    async () => {
      // Given the example on an operation whose collectors produced error contracts
      const measured = await runtimeGaps(`${EXAMPLE_BASE_PATH}/get-orders`);

      // Then the text does not run into its note, and one value does not run into the next.
      // Both were zero once, which is what made the runtime block read as a log line.
      expect(measured.afterStatus).toBeGreaterThanOrEqual(4);
      expect(measured.betweenItems).toBeGreaterThanOrEqual(4);
    },
    TIMEOUT,
  );
});

describe('the parity rows of an operation page', () => {
  it(
    'should give the spec and runtime cells of every row equal width, with the gutter between',
    async () => {
      // Given the example, whose collectors are registered, on an operation that carries facts.
      // The pair exists only inside a row since TX-GUTTER, so the equality frame.spec held on
      // the page columns is held on the two cells of each row, which is where F29's answer
      // lives: a row ends at its taller cell and no page-level half can be empty.
      const measured = await frame(`${EXAMPLE_BASE_PATH}/get-orders`);

      // When, the cells arrive in document order, spec then runtime per row
      const pairs: (readonly [number, number])[] = [];
      for (let at = 0; at < measured.columns.length; at += 2) {
        pairs.push([measured.columns[at] ?? 0, measured.columns[at + 1] ?? 0]);
      }

      // Then, eleven rows and each pair equal to the pixel
      expect(pairs).toHaveLength(11);
      for (const [spec, runtime] of pairs) {
        expect(spec).toBeGreaterThan(0);
        expect(Math.abs(spec - runtime)).toBeLessThanOrEqual(1);
      }
    },
    TIMEOUT,
  );
});

describe('the glyphs of the parity scale', () => {
  it(
    'should render all eight marks at a non-zero width, through the declared mono fallback',
    async () => {
      // Given the maintainer's 2026-08-14 decision: the font subsets do not grow for eight
      // characters, the marks resolve through the mono stack's system fallback, and a glyph
      // that silently boxes is worse than one that looks slightly different, so the width is
      // asserted in a real engine rather than assumed.
      const context = await chrome.browser.newContext({ viewport: WIDE });
      const page = await context.newPage();
      await page.goto(`${app.url}${EXAMPLE_BASE_PATH}/get-orders`, { waitUntil: 'load' });

      // When each mark is set on a live verdict box and its text measured
      const measured = await page.evaluate(() => {
        interface BoxLike {
          readonly width: number;
        }
        interface NodeLike {
          readonly firstChild: NodeLike | null;
        }
        interface ElementLike extends NodeLike {
          textContent: string | null;
        }
        interface RangeLike {
          selectNode(node: NodeLike): void;
          getBoundingClientRect(): BoxLike;
        }
        const root = globalThis as unknown as {
          document: {
            createRange(): RangeLike;
            querySelector(selector: string): ElementLike | null;
          };
          getComputedStyle(element: ElementLike): { fontFamily: string };
        };

        const verdict = root.document.querySelector('.oref-verdict');
        if (verdict === null) return { widths: {}, fontFamily: '' };

        const glyphs = ['=', '≠', '?', '▲', '△', '·', '■', '◆', '○'];
        const widths: Record<string, number> = {};
        for (const glyph of glyphs) {
          verdict.textContent = glyph;
          const text = verdict.firstChild;
          if (text === null) continue;
          const range = root.document.createRange();
          range.selectNode(text);
          widths[glyph] = range.getBoundingClientRect().width;
        }

        return { widths, fontFamily: root.getComputedStyle(verdict).fontFamily };
      });

      await context.close();

      // Then every mark occupies real width and the stack's tail is the generic family, which
      // is what makes the fallback a declaration rather than an accident.
      expect(Object.keys(measured.widths)).toHaveLength(9);
      for (const [glyph, width] of Object.entries(measured.widths)) {
        expect(width, `the glyph ${glyph} rendered at zero width`).toBeGreaterThan(0);
      }
      expect(measured.fontFamily).toContain('monospace');
    },
    TIMEOUT,
  );
});

/**
 * The tab bar and the addresses behind it, per SPEC 11 and 13.3, since TX-FRAME.
 *
 * THE TABS ARE PAGES AND THE PROOF IS A RELOAD: each tab's href is navigated to cold, and the
 * page that answers marks that tab current. An anchor would survive none of this. The DOM is
 * described in each callback rather than imported, per this file's own header.
 */
describe('the tab bar of the frame', () => {
  interface TabFacts {
    readonly label: string;
    readonly href: string;
    readonly active: boolean;
  }

  /** The bar as served on one page. */
  async function tabsOn(page: Page): Promise<TabFacts[]> {
    return page.evaluate(() => {
      interface ElementLike {
        readonly textContent: string | null;
        getAttribute(name: string): string | null;
      }
      const root = globalThis as unknown as {
        document: { querySelectorAll(selector: string): readonly ElementLike[] };
      };

      return [...root.document.querySelectorAll('.oref-tab')].map((anchor) => ({
        label: anchor.textContent ?? '',
        href: anchor.getAttribute('href') ?? '',
        active: anchor.getAttribute('aria-current') === 'page',
      }));
    });
  }

  it(
    'should carry the six tabs on an operation page, each an address that survives a reload',
    async () => {
      // Given the operation page of the demo, whose bar is the prototype's six since
      // TX-PARITY-UI: operation, schema, shapes, bench, health, states
      const context = await chrome.browser.newContext({ viewport: WIDE });
      const page = await context.newPage();
      await page.goto(`${app.url}${EXAMPLE_BASE_PATH}/get-orders`, { waitUntil: 'load' });

      // When the bar is read
      const tabs = await tabsOn(page);

      // Then, all six, the operation tab active, and the schema tab landed on the item schema
      // of the list operation, per item 28: OrderDto, not the ProblemDto of the first error
      expect(tabs.map((tab) => tab.label.replace(/\d+$/, ''))).toEqual([
        'Operation',
        'Schema',
        'Shapes',
        'Bench',
        'Health',
        'States',
      ]);
      expect(tabs[0]?.active).toBe(true);
      expect(tabs[0]?.href).toBe(`${EXAMPLE_BASE_PATH}/get-orders`);
      expect(tabs[1]?.href).toBe(`${EXAMPLE_BASE_PATH}/schema/OrderDto`);
      expect(tabs[2]?.href).toBe(`${EXAMPLE_BASE_PATH}/shapes/OrderDto`);
      expect(tabs[3]?.href).toBe(`${EXAMPLE_BASE_PATH}/bench/get-orders`);
      expect(tabs[4]?.href).toBe(`${EXAMPLE_BASE_PATH}/health`);
      expect(tabs[5]?.href).toBe(`${EXAMPLE_BASE_PATH}/states`);

      // And each address answers a cold load with its own tab current, the memory keeping the
      // operation tabs in the bar on the pages that have none of their own
      for (const tab of tabs.slice(1)) {
        const response = await page.goto(`${app.url}${tab.href}`, { waitUntil: 'load' });
        expect(response?.status()).toBe(200);
        const current = (await tabsOn(page)).find((candidate) => candidate.active)?.href ?? '';
        expect(current).toBe(tab.href);
      }

      await context.close();
    },
    TIMEOUT,
  );

  it(
    'should remember the operation across the four pages, per TX-PARITY-UI',
    async () => {
      // Given a reader who was on GET /orders and walks to the four operation-less pages
      const context = await chrome.browser.newContext({ viewport: WIDE });
      const page = await context.newPage();
      await page.goto(`${app.url}${EXAMPLE_BASE_PATH}/get-orders`, { waitUntil: 'load' });
      const crumb = await page.evaluate(() => {
        interface ElementLike {
          readonly textContent: string | null;
        }
        const root = globalThis as unknown as {
          document: { querySelector(selector: string): ElementLike | null };
        };
        return root.document.querySelector('.oref-crumb')?.textContent ?? '';
      });

      for (const target of ['/health', '/states', '/schema/OrderDto', '/shapes/OrderDto']) {
        // When the reader arrives on a page that has no operation of its own
        await page.goto(`${app.url}${EXAMPLE_BASE_PATH}${target}`, { waitUntil: 'load' });
        const state = await page.evaluate(() => {
          interface ElementLike {
            readonly textContent: string | null;
            getAttribute(name: string): string | null;
          }
          const root = globalThis as unknown as {
            document: {
              querySelector(selector: string): ElementLike | null;
              querySelectorAll(selector: string): readonly ElementLike[];
            };
          };

          return {
            crumb: root.document.querySelector('.oref-crumb')?.textContent ?? '',
            operationTab:
              [...root.document.querySelectorAll('.oref-tab')]
                .find((tab) => (tab.textContent ?? '').startsWith('Operation'))
                ?.getAttribute('href') ?? '',
            railCurrent:
              root.document
                .querySelector('.oref-nav-item[aria-current="page"]')
                ?.getAttribute('href') ?? '',
          };
        });

        // Then the operation tab points back, the crumb stays the operation's, and the rail's
        // aria-current stays on it
        expect(state.operationTab, `${target} lost the operation tab`).toBe(
          `${EXAMPLE_BASE_PATH}/get-orders`,
        );
        expect(state.crumb, `${target} lost the crumb`).toBe(crumb);
        expect(state.railCurrent, `${target} lost the rail current`).toBe(
          `${EXAMPLE_BASE_PATH}/get-orders`,
        );
      }

      // And a fresh visitor with no memory sees no operation tabs on the same page
      const fresh = await chrome.browser.newContext({ viewport: WIDE });
      const cold = await fresh.newPage();
      await cold.goto(`${app.url}${EXAMPLE_BASE_PATH}/health`, { waitUntil: 'load' });
      const coldTabs = await cold.evaluate(() => {
        interface ElementLike {
          readonly textContent: string | null;
        }
        const root = globalThis as unknown as {
          document: { querySelectorAll(selector: string): readonly ElementLike[] };
        };
        return [...root.document.querySelectorAll('.oref-tab')].map((tab) => tab.textContent ?? '');
      });
      expect(coldTabs.some((label) => label.startsWith('Operation'))).toBe(false);
      expect(coldTabs.some((label) => label.startsWith('Health'))).toBe(true);

      await fresh.close();
      await context.close();
    },
    TIMEOUT,
  );

  it(
    'should compute all three active signals in the engine: colour, surface, border',
    async () => {
      // Given, the reason is monochrome print: a signal living in one colour disappears on
      // paper, so the active tab carries three, and each is asserted on the computed style
      // rather than on a class name.
      const context = await chrome.browser.newContext({ viewport: WIDE });
      const page = await context.newPage();
      await page.goto(`${app.url}${EXAMPLE_BASE_PATH}/get-orders`, { waitUntil: 'load' });

      // When
      const signals = await page.evaluate(() => {
        interface ElementLike {
          readonly textContent: string | null;
        }
        interface StyleLike {
          readonly color: string;
          readonly backgroundColor: string;
          readonly borderBottomColor: string;
          readonly borderBottomWidth: string;
        }
        const root = globalThis as unknown as {
          document: { querySelector(selector: string): ElementLike | null };
          getComputedStyle(element: ElementLike): StyleLike;
        };

        const active = root.document.querySelector('.oref-tab[aria-current="page"]');
        const idle = root.document.querySelector('.oref-tab:not([aria-current])');
        if (active === null || idle === null) return null;
        const activeStyle = root.getComputedStyle(active);
        const idleStyle = root.getComputedStyle(idle);

        return {
          colourDiffers: activeStyle.color !== idleStyle.color,
          surfaceDiffers: activeStyle.backgroundColor !== idleStyle.backgroundColor,
          activeEdge: activeStyle.borderBottomColor,
          idleEdge: idleStyle.borderBottomColor,
          edgeWidth: activeStyle.borderBottomWidth,
        };
      });

      // Then
      expect(signals).not.toBeNull();
      expect(signals?.colourDiffers).toBe(true);
      expect(signals?.surfaceDiffers).toBe(true);
      expect(signals?.edgeWidth).toBe('2px');
      expect(signals?.activeEdge).not.toBe(signals?.idleEdge);
      expect(signals?.idleEdge).toContain('0, 0, 0, 0');

      await context.close();
    },
    TIMEOUT,
  );

  it(
    'should link the showcase pages from the bar and keep them out of the rail',
    async () => {
      // Given the maintainer's 2026-08-14 reversal, per TX-PARITY-UI: the bar is the
      // prototype's six constant items, so shapes and states entered it; the rail is the
      // document's tree and still lists neither, because a page kind is not a node.
      const context = await chrome.browser.newContext({ viewport: WIDE });
      const page = await context.newPage();

      await page.goto(`${app.url}${EXAMPLE_BASE_PATH}/get-orders`, { waitUntil: 'load' });
      const links = await page.evaluate(() => {
        interface ElementLike {
          getAttribute(name: string): string | null;
        }
        const root = globalThis as unknown as {
          document: { querySelectorAll(selector: string): readonly ElementLike[] };
        };

        const of = (selector: string): readonly string[] =>
          [...root.document.querySelectorAll(selector)].map(
            (anchor) => anchor.getAttribute('href') ?? '',
          );

        return { bar: of('.oref-tabs a[href]'), rail: of('.oref-nav a[href]') };
      });

      expect(links.bar.some((href) => href.includes('/states'))).toBe(true);
      expect(links.bar.some((href) => href.includes('/shapes/'))).toBe(true);
      expect(links.rail.some((href) => href.includes('/states'))).toBe(false);
      expect(links.rail.some((href) => href.includes('/shapes/'))).toBe(false);

      // And the addresses answer, which the tabs now promise
      const states = await page.goto(`${app.url}${EXAMPLE_BASE_PATH}/states`, {
        waitUntil: 'load',
      });
      expect(states?.status()).toBe(200);
      const statesTitle = await page.evaluate(() => {
        interface ElementLike {
          readonly textContent: string | null;
        }
        const root = globalThis as unknown as {
          document: { querySelector(selector: string): ElementLike | null };
        };

        return root.document.querySelector('.oref-states-page .oref-title')?.textContent ?? '';
      });
      expect(statesTitle).toBe('Empty and degraded states');

      await context.close();
    },
    TIMEOUT,
  );
});

/**
 * The rail's statistics and drift counters, per TX-FRAME.
 */
describe('the rail of the frame', () => {
  it(
    'should state the document counts and mark the drifted entries',
    async () => {
      // Given the demo, whose collectors produce findings
      const context = await chrome.browser.newContext({ viewport: WIDE });
      const page = await context.newPage();
      await page.goto(`${app.url}${EXAMPLE_BASE_PATH}/get-orders`, { waitUntil: 'load' });

      // When
      const rail = await page.evaluate(() => {
        interface ElementLike {
          readonly textContent: string | null;
        }
        interface StyleLike {
          readonly borderInlineStartColor: string;
        }
        const root = globalThis as unknown as {
          document: {
            querySelector(selector: string): ElementLike | null;
            querySelectorAll(selector: string): readonly ElementLike[];
          };
          getComputedStyle(element: ElementLike): StyleLike;
        };

        const active = root.document.querySelector('.oref-nav-item.oref-active');

        return {
          stats: root.document.querySelector('.oref-nav-stats')?.textContent ?? '',
          drift: root.document.querySelector('.oref-nav-stats-drift')?.textContent ?? '',
          markers: root.document.querySelectorAll('.oref-nav-drift').length,
          activeEdge: active === null ? '' : root.getComputedStyle(active).borderInlineStartColor,
        };
      });

      // Then the stats row states the whole document, the drift cell carries the report's
      // total, at least one entry wears a marker, and the active item carries a resolved edge
      // colour rather than the transparent idle one.
      expect(rail.stats).toContain('operations');
      expect(rail.stats).toContain('groups');
      expect(rail.drift).toMatch(/▲ \d+/);
      expect(rail.markers).toBeGreaterThan(0);
      expect(rail.activeEdge).not.toBe('');
      expect(rail.activeEdge).not.toContain('0, 0, 0, 0');

      await context.close();
    },
    TIMEOUT,
  );
});

/**
 * The narrow collapse of the parity scale, per SPEC 11: a container query on the scale's own
 * width, at the measured threshold of 500px. Both sides of the threshold are driven, because a
 * collapse that never engages and one that never releases are the same silent failure.
 */
describe('the narrow collapse of the parity scale', () => {
  interface CollapseFacts {
    readonly container: number;
    readonly tracks: number;
    readonly specHeading: string;
    readonly runtimeHeading: string;
    readonly headDisplay: string;
    readonly gutterWide: boolean;
  }

  /** Reads the collapse facts at one viewport width. */
  async function collapseAt(width: number): Promise<CollapseFacts> {
    const context = await chrome.browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${app.url}${EXAMPLE_BASE_PATH}/get-orders`, { waitUntil: 'load' });

    const measured = await page.evaluate(() => {
      interface BoxLike {
        readonly width: number;
        readonly height: number;
      }
      interface ElementLike {
        getBoundingClientRect(): BoxLike;
      }
      interface StyleLike {
        readonly gridTemplateColumns: string;
        readonly content: string;
        readonly display: string;
      }
      const root = globalThis as unknown as {
        document: { querySelector(selector: string): ElementLike | null };
        getComputedStyle(element: ElementLike, pseudo?: string): StyleLike;
      };

      const section = root.document.querySelector('.oref-section-runtime');
      const grid = root.document.querySelector('.oref-parity-grid');
      const head = root.document.querySelector('.oref-parity-head');
      const spec = root.document.querySelector('.oref-parity-cell-spec');
      const runtime = root.document.querySelector('.oref-parity-cell-runtime');
      const gutter = root.document.querySelector('.oref-parity-gutter');
      if (section === null || grid === null || spec === null || runtime === null) return null;

      const gutterBox = gutter?.getBoundingClientRect();

      return {
        container: section.getBoundingClientRect().width,
        tracks: root.getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        specHeading: root.getComputedStyle(spec, '::before').content,
        runtimeHeading: root.getComputedStyle(runtime, '::before').content,
        headDisplay: head === null ? '' : root.getComputedStyle(head).display,
        gutterWide: gutterBox !== undefined && gutterBox.width > gutterBox.height,
      };
    });

    await context.close();
    if (measured === null) throw new Error('the parity scale was not on the page');

    return measured;
  }

  it(
    'should draw the pair above the threshold and the column below it, by container width',
    async () => {
      // Given a window whose content column holds the scale well above 500px
      const wide = await collapseAt(1600);

      // Then the pair stands: three tracks, the head shown, no micro headings
      expect(wide.container).toBeGreaterThan(500);
      expect(wide.tracks).toBe(3);
      expect(wide.headDisplay).not.toBe('none');
      expect(wide.specHeading).toBe('none');

      // Given a window whose rail and gutter leave the scale under the threshold
      const narrow = await collapseAt(760);

      // Then the scale is a column: one track, the head gone, the headings inside the cells
      // as micro headings, and the gutter lying down wider than it is tall
      expect(narrow.container).toBeLessThan(500);
      expect(narrow.tracks).toBe(1);
      expect(narrow.headDisplay).toBe('none');
      expect(narrow.specHeading).toContain('Specification declares');
      expect(narrow.runtimeHeading).toContain('Application does');
      expect(narrow.gutterWide).toBe(true);
    },
    TIMEOUT,
  );
});
