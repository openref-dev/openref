import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootFixture, FIXTURE_BASE_PATH, firstNodePage, launchChrome } from '../../src/index';
import type { BootedFixture, LaunchedChrome } from '../../src/index';

/**
 * The virtualized rail, measured where it is drawn.
 *
 * WHAT WAS SHIPPED AND WHAT NOBODY COULD SEE. `NavigationTree` bound its scroll handler to
 * `.oref-nav-scroll`, which the default theme draws `display: block` with a visible overflow;
 * the element that scrolls is `.oref-sidebar` above it, and a `scroll` event does not bubble.
 * So the handler never fired, the window stayed on whatever chunk the first render chose, and
 * nothing scrolled the container to it. A reader whose entry was in chunk two or beyond met the
 * reserved height of the chunks above it as a blank band with the rows below the fold. Measured
 * on the maintainer's own reference at 1440x640: 602.9px of blank, then two rows.
 *
 * IT COULD NOT HAVE BEEN CAUGHT IN jsdom, AND TWO COMMITTED TESTS PROVE THAT RATHER THAN
 * DISPROVING IT. `reference-ui.spec.ts` defined `scrollTop`, `scrollHeight` and `clientHeight`
 * onto `.oref-nav-scroll` and dispatched a synthetic `scroll` on it, which fabricated the exact
 * assumption the shipped stylesheet falsifies. Both were green for five milestones. Which
 * element scrolls is decided by computed overflow, which is layout, and jsdom performs none, so
 * this belongs here with the frame and the token conformance and nowhere else.
 *
 * THE FIXTURE IS THE THOUSAND NODE ONE BECAUSE THE TRIGGER IS A SIZE. `sliceNavigation` ships
 * the whole of the active operation's group, so the row count, and with it the chunk the active
 * row lands in, is a function of that group's size. The large document's groups hold about
 * fifty operations each, which is four chunks, and the last of them is in chunk two or beyond.
 */

const TIMEOUT = 300_000;

/** The viewport the defect was reported at. */
const REPORTED = { width: 1440, height: 640 };

/** What one reading of the rail is made of. */
interface RailGeometry {
  /** Class list of the element the component bound its handler to. */
  readonly scrollerClass: string;
  /** Computed `overflow-y` of that element. */
  readonly overflowY: string;
  /** Whether that element has anything to scroll. */
  readonly scrollable: number;
  /** Whether `.oref-nav-scroll`, the element the handler used to sit on, scrolls at all. */
  readonly railScrollable: number;
  readonly chunks: number;
  /** Index of the chunk holding the active row, or -1 when no row is active. */
  readonly activeChunk: number;
  /** Rows whose box intersects the scroll container's client box. */
  readonly rowsInView: number;
  /** Whether the active row's box intersects that client box. */
  readonly activeInView: boolean;
  /** Distance from the top of the client box to the first row inside it, in pixels. */
  readonly blankBefore: number;
}

let chrome: LaunchedChrome;
let fixture: BootedFixture;

beforeAll(async () => {
  chrome = await launchChrome();
  fixture = await bootFixture('large');
}, TIMEOUT);

afterAll(async () => {
  await fixture.stop();
  await chrome.close();
}, TIMEOUT);

/**
 * Opens a page and reads the rail off a real layout.
 *
 * THE DOM IS DECLARED HERE RATHER THAN IMPORTED, the way `frame.spec.ts` declares it: this
 * package compiles against Node's libraries and the callback below runs in the browser.
 *
 * @param url - Absolute url of the page to open
 * @returns The geometry, and the href of the deepest row the rail drew
 */
async function railOf(url: string): Promise<{ geometry: RailGeometry; deepest: string }> {
  const context = await chrome.browser.newContext({ viewport: REPORTED });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'load' });

    return await page.evaluate(() => {
      interface BoxLike {
        readonly top: number;
        readonly bottom: number;
      }
      interface ElementLike {
        readonly className: string;
        readonly clientTop: number;
        readonly clientHeight: number;
        readonly scrollHeight: number;
        getAttribute(name: string): string | null;
        closest(selector: string): ElementLike | null;
        getBoundingClientRect(): BoxLike;
      }
      const root = globalThis as unknown as {
        document: {
          querySelector(selector: string): ElementLike | null;
          querySelectorAll(selector: string): readonly ElementLike[];
        };
        getComputedStyle(element: ElementLike): { readonly overflowY: string };
      };

      const scroller = root.document.querySelector('[data-oref-nav-scroller]');
      const rail = root.document.querySelector('.oref-nav-scroll');
      const lists = [...root.document.querySelectorAll('.oref-nav-list')];
      const active = root.document.querySelector('.oref-nav-item.oref-active');
      // THE GEOMETRY IS READ OFF THE CONTAINER WHETHER OR NOT ANYTHING CLAIMED IT, so that the
      // reading of a renderer that binds nothing is the reader's own view and not a division by
      // a missing element. On the unfixed bundle this reads blankBefore 602.9 with two rows.
      const view = scroller ?? root.document.querySelector('.oref-sidebar');
      const box = view?.getBoundingClientRect() ?? { top: 0, bottom: 0 };
      const top = box.top + (view?.clientTop ?? 0);
      const bottom = top + (view?.clientHeight ?? 0);
      const inView = (element: ElementLike): boolean => {
        const at = element.getBoundingClientRect();
        return at.bottom > top && at.top < bottom;
      };

      const rows = [...root.document.querySelectorAll('.oref-nav-item')];
      const visible = rows.filter(inView);
      const first = visible[0]?.getBoundingClientRect().top ?? bottom;

      return {
        geometry: {
          scrollerClass: scroller?.className ?? '',
          overflowY: scroller === null ? '' : root.getComputedStyle(scroller).overflowY,
          scrollable: (scroller?.scrollHeight ?? 0) - (scroller?.clientHeight ?? 0),
          railScrollable: (rail?.scrollHeight ?? 0) - (rail?.clientHeight ?? 0),
          chunks: lists.length,
          activeChunk: Number(
            active?.closest('.oref-nav-list')?.getAttribute('data-oref-chunk') ?? -1,
          ),
          rowsInView: visible.length,
          activeInView: active !== null && inView(active),
          blankBefore: Math.round((first - top) * 10) / 10,
        },
        deepest:
          rows
            .map((element) => element.getAttribute('href'))
            .filter((href): href is string => href !== null)
            .pop() ?? '',
      };
    });
  } finally {
    await context.close();
  }
}

/**
 * Walks to a page whose own entry is deep enough to have a reserved chunk above it.
 *
 * @returns The rail of that page
 * @throws Error when four hops of the deepest row reach no such page, which would mean the
 *   document this is measured against stopped being large enough to carry the defect
 */
async function deepEntry(): Promise<RailGeometry> {
  let url = await firstNodePage(fixture.url);

  for (let hop = 0; hop < 4; hop += 1) {
    const { geometry, deepest } = await railOf(url);
    if (geometry.activeChunk >= 2) return geometry;
    if (deepest === '') break;

    url = new URL(deepest, `${fixture.url}${FIXTURE_BASE_PATH}`).href;
  }

  throw new Error('no page of the large fixture puts its own entry in chunk two or beyond');
}

describe('the rail a reader arrives at', () => {
  it(
    'should bind the scroll handler to the element whose computed overflow scrolls',
    async () => {
      // Given a page of the thousand node document
      const entry = await firstNodePage(fixture.url);

      // When
      const { geometry } = await railOf(entry);

      // Then the handler is on an element that really is a scroll container, and it is not the
      // block the handler used to sit on, which has nothing to scroll at all.
      expect(geometry.scrollerClass).toContain('oref-sidebar');
      expect(['auto', 'scroll', 'overlay']).toContain(geometry.overflowY);
      expect(geometry.scrollable).toBeGreaterThan(0);
      expect(geometry.railScrollable).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'should open a deep entry with rows in the first screenful and the entry among them',
    async () => {
      // Given a page whose own entry is in chunk two or beyond, which is what the defect needs:
      // one chunk of reserved height above the window is what a reader met as blank. It is
      // reached by following the deepest row the rail draws, twice, because each page slices
      // the navigation around its own group and the deepest row moves with it.
      const geometry = await deepEntry();

      // Then the rail is not a blank band: its first screenful carries rows, and the row the
      // page is about is one of the rows on screen. Measured on the unfixed bundle at this
      // viewport, the same page reads blankBefore 602.9, rowsInView 2, activeInView false.
      expect(geometry.chunks).toBeGreaterThanOrEqual(4);
      expect(geometry.activeChunk).toBeGreaterThanOrEqual(2);
      expect(geometry.rowsInView).toBeGreaterThan(2);
      expect(geometry.blankBefore).toBeLessThan(120);
      expect(geometry.activeInView).toBe(true);
    },
    TIMEOUT,
  );
});
