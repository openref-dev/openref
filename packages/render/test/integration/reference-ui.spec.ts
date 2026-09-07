// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from 'vue';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { schemaHref } from '../../src/page/domain/links';
import { NAV_MAX_ROWS } from '../../src/page/domain/nav-rows';
import { buildNavigation, buildPageModel, type PageModel } from '../../src/page/domain/page-model';
import { ReferenceApp } from '../../src/components/ReferenceApp';
import { DEFERRABLE_KEY } from '../../src/components/deferrable';
import { EAGER_COMPONENTS } from '../../src/components/eager';
import {
  cyclicDocument,
  largeDocument,
  smallDocument,
  wrappedReferenceDocument,
} from '../mocks/documents';
import type { IRDocument } from '@openref/core';

/**
 * The reference UI as a reader uses it, per BUILD T012 and SPEC 11.
 *
 * These are the assertions that cannot be made against markup alone: a schema opens a level at a
 * time, a cycle stops, the sidebar stays bounded while it is scrolled, and the whole path from
 * the search key to a schema field can be walked without a pointer.
 */

const markdown = await createMarkdownRenderer();

let mounted: { unmount(): void } | null = null;

/**
 * Mounts a page, optionally with the rest of the navigation reachable.
 *
 * The loader stands in for the request the browser bundle makes to the page's own origin. It
 * resolves from the document in hand rather than over a network, because what these tests are
 * about is what the components do with the answer, and `packages/nest` proves the route that
 * produces it.
 */
function mount(page: PageModel, document_?: IRDocument): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);

  const app = createApp(ReferenceApp, {
    page,
    basePath: '',
    ...(document_ === undefined
      ? {}
      : { loadNavigation: () => Promise.resolve(buildNavigation(document_)) }),
  });
  // THE EAGER REGISTRY, BECAUSE THESE ARE TESTS OF THE COMPONENTS AND NOT OF THE DEFERRAL.
  // The server render provides the same one for the same reason: what is asserted below is what
  // the schema viewer, the palette and the navigation do, and a gate in front of them would
  // assert that Vue can wait. `deferred.spec.ts` owns the gate itself.
  app.provide(DEFERRABLE_KEY, EAGER_COMPONENTS);
  app.mount(host);
  mounted = app;

  return host;
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  layout?.remove();
  layout = null;
});

let layout: HTMLStyleElement | null = null;

/**
 * Lays the rail out the way the shipped theme lays it out, before anything is mounted.
 *
 * WHAT THIS REPLACES IS THE DEFECT THE TWO CASES BELOW USED TO ENCODE. Both of them defined
 * `scrollTop`, `scrollHeight` and `clientHeight` onto `.oref-nav-scroll` and dispatched a
 * synthetic `scroll` on it, which fabricated the single assumption the shipped stylesheet
 * falsifies: that element is `display: block` with a visible overflow, it never scrolls, and a
 * `scroll` event does not bubble, so nothing on it ever fires. A test that builds its own
 * subject proves the fabrication and not the product, and these two were green for as long as
 * the sidebar was broken in every browser.
 *
 * The two declarations are the shipped theme's own, at `.oref-sidebar` and at the rule whose
 * whole body is `display: block` in `packages/theme/src/styles/theme.css`. They are installed
 * before the mount because the component reads the computed overflow once, when it mounts. What
 * a real engine says about the real stylesheet is asserted in `tools/browser-budget`, which is
 * where a claim about computed layout belongs.
 */
function layOutLikeTheTheme(): void {
  layout = document.createElement('style');
  layout.textContent =
    '.oref-sidebar { overflow-y: auto; max-height: 640px }' +
    '.oref-nav-scroll { display: block; overflow-y: visible }';
  document.head.append(layout);
}

/** The element the component bound its scroll handler to, which is the only one worth driving. */
function boundScroller(): Element {
  const marked = document.querySelector('[data-oref-nav-scroller]');
  if (marked === null) throw new Error('the navigation bound its scroll handler to nothing');

  return marked;
}

/** Puts a scroll position on the container the component is listening to, and reports it. */
function scrollTo(target: Element, top: number): void {
  Object.defineProperties(target, {
    scrollTop: { value: top, configurable: true },
    scrollHeight: { value: 20_200, configurable: true },
    clientHeight: { value: 200, configurable: true },
  });
  target.dispatchEvent(new Event('scroll'));
}

function press(
  target: Element | Document | null,
  key: string,
  modifiers: KeyboardEventInit = {},
): void {
  if (target === null) return;
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
}

function rowByName(host: HTMLElement, name: string): HTMLElement | null {
  for (const element of Array.from(host.querySelectorAll('.oref-schema-row'))) {
    if (element.querySelector('.oref-schema-name')?.textContent === name) {
      return element as HTMLElement;
    }
  }
  return null;
}

/**
 * Focuses an element through the one member this needs.
 *
 * ESLint reads types for this package out of `dist`, per the note T008 left, and the DOM lib is
 * scoped to this suite's own program. Calling `focus()` off an `HTMLElement` therefore reads as
 * an unresolved call to the linter while typechecking cleanly. Saying structurally what is being
 * called is honest and costs a line.
 */
function focusElement(element: Element | null): void {
  (element as unknown as { focus(): void } | null)?.focus();
}

describe('the schema viewer', () => {
  it('should show the first level and nothing below it until something is opened', async () => {
    // Given, laziness is the point: a document of a thousand schemas costs one level per open
    // position and nothing for the rest.
    const document_ = cyclicDocument();
    // The tree lives on the schema page since TX-PARITY-UI: the response rows link there
    // instead of expanding inline, so the viewer is asserted where it draws.
    const host = mount(buildPageModel(document_, { schemaId: 'Node', markdown }));

    // When
    const before = host.querySelectorAll('.oref-schema-row').length;
    const closed = rowByName(host, 'name');
    rowByName(host, 'owner')?.click();
    await Promise.resolve();

    // Then, the first level was there without anyone acting, and `Person.name` arrived only
    // when `owner` was opened.
    expect(rowByName(host, 'id')).not.toBeNull();
    expect(closed).toBeNull();
    expect(rowByName(host, 'name')).not.toBeNull();
    expect(host.querySelectorAll('.oref-schema-row').length).toBeGreaterThan(before);
  });

  it('should mark a revisit as a cycle and produce nothing under it', async () => {
    // Given, `Node.parent` is a `Node`. SPEC 5.1.1 puts no `$cycle` marker in the IR for a named
    // cycle, so the marker here is the viewer detecting the revisit on its own path.
    const document_ = cyclicDocument();
    // The tree lives on the schema page since TX-PARITY-UI: the response rows link there
    // instead of expanding inline, so the viewer is asserted where it draws.
    const host = mount(buildPageModel(document_, { schemaId: 'Node', markdown }));

    // When
    const parent = rowByName(host, 'parent');
    const cycles = host.querySelectorAll('.oref-schema-cycle');

    // Then
    expect(parent).not.toBeNull();
    expect(cycles.length).toBeGreaterThan(0);
    expect(parent?.tagName).toBe('DIV');
    await Promise.resolve();
  });

  it('should terminate on a two step cycle rather than expanding for ever', async () => {
    // Given, `Node.owner` reaches `Person`, and `Person.favourite` reaches `Node` again. A guard
    // that only compared with the immediate parent would miss this one.
    const document_ = cyclicDocument();
    // The tree lives on the schema page since TX-PARITY-UI: the response rows link there
    // instead of expanding inline, so the viewer is asserted where it draws.
    const host = mount(buildPageModel(document_, { schemaId: 'Node', markdown }));

    // When
    rowByName(host, 'owner')?.click();
    await Promise.resolve();
    const favourite = rowByName(host, 'favourite');

    // Then
    expect(favourite).not.toBeNull();
    expect(favourite?.classList.contains('oref-schema-cycle-row')).toBe(true);
    expect(favourite?.tagName).toBe('DIV');
  });

  it('should label the branches of a union from the discriminator mapping', async () => {
    // Given, `Shape` is a `oneOf` whose mapping names `round` and `boxy`. Without the mapping
    // the reader gets `oneOf[0]`, which says nothing about which branch is which.
    const document_ = cyclicDocument();
    const nodeId = [...document_.nodes.keys()].find((id) => id.startsWith('post')) ?? '';
    const host = mount(buildPageModel(document_, { nodeId, markdown }));

    // When
    const labels = Array.from(host.querySelectorAll('.oref-schema-name')).map(
      (element) => element.textContent,
    );

    // Then
    expect(labels).toContain('round');
    expect(labels).toContain('boxy');
    await Promise.resolve();
  });

  it('should drop a read only field from the request view', async () => {
    // Given, `Node.id` is readOnly and `Node.label` is writeOnly, so each view shows one of them.
    const document_ = cyclicDocument();
    const post = [...document_.nodes.keys()].find((id) => id.startsWith('post')) ?? '';
    const get = [...document_.nodes.keys()].find((id) => id.startsWith('get')) ?? '';

    // When
    const request = mount(buildPageModel(document_, { nodeId: post, markdown }));
    request.querySelectorAll('.oref-schema-row').forEach(() => undefined);
    const response = buildPageModel(document_, { nodeId: get, markdown });

    // Then
    expect(response.node?.responses[0]?.content[0]?.view).toBe('response');
    expect(request.querySelector('.oref-schema-tree')).not.toBeNull();
    await Promise.resolve();
  });

  it('should link to a schema page for a target the bound left behind', async () => {
    // Given, a payload too small to carry `Person`.
    const document_ = cyclicDocument();
    const page = buildPageModel(document_, { schemaId: 'Node', markdown, schemaPayloadLimit: 400 });

    // When
    const host = mount(page);
    const links = Array.from(host.querySelectorAll('.oref-schema-link')).map((element) =>
      element.getAttribute('href'),
    );

    // Then
    expect(page.truncatedSchemas.length).toBeGreaterThan(0);
    expect(links.some((href) => href?.startsWith('/schema/') === true)).toBe(true);
    await Promise.resolve();
  });

  it('should type a wrapped reference by its schema name rather than as an anonymous object', async () => {
    // Given, the property `OrderDto.customer` written as `allOf: [{ $ref }]` with a description.
    // In the browser on the demo it rendered as a row typed `object` with no name while
    // `CustomerDto` sat in the same sidebar with a page of its own. Retrofit T003-R2.
    const document_ = wrappedReferenceDocument();
    const host = mount(buildPageModel(document_, { schemaId: 'OrderDto', markdown }));

    // When
    const row = rowByName(host, 'customer');
    const type = row?.querySelector('.oref-schema-type')?.textContent;

    // Then, and the presence assertion is the same one that keeps a proof of absence honest:
    // a row that is not there types nothing and would pass a check for "not object".
    expect(row).not.toBeNull();
    expect(type).toBe('CustomerDto');
    expect(row?.querySelector('.oref-schema-doc')?.textContent).toBe('Who placed it.');
    await Promise.resolve();
  });

  it('should link a wrapped reference to its own page when the payload left the target behind', async () => {
    // Given, a payload too small to carry `CustomerDto`
    const document_ = wrappedReferenceDocument();
    const page = buildPageModel(document_, {
      schemaId: 'OrderDto',
      markdown,
      schemaPayloadLimit: 260,
    });

    // When
    const host = mount(page);
    const link = rowByName(host, 'customer')?.querySelector('.oref-schema-link');

    // Then
    expect(page.truncatedSchemas).toContain('CustomerDto');
    expect(link?.getAttribute('href')).toBe(schemaHref('CustomerDto', ''));
    expect(link?.textContent).toBe('CustomerDto');
    await Promise.resolve();
  });

  it('should move through the tree with the arrow keys and open with the right arrow', async () => {
    // Given
    const document_ = cyclicDocument();
    // The tree lives on the schema page since TX-PARITY-UI: the response rows link there
    // instead of expanding inline, so the viewer is asserted where it draws.
    const host = mount(buildPageModel(document_, { schemaId: 'Node', markdown }));
    const root = host.querySelector('.oref-schema-row')!;

    // When
    focusElement(root);
    press(root, 'ArrowDown');
    await Promise.resolve();
    const focused = document.activeElement as HTMLElement | null;

    // Then
    expect(focused?.getAttribute('data-oref-path')).not.toBe(root.getAttribute('data-oref-path'));
    expect(focused?.classList.contains('oref-schema-row')).toBe(true);
  });

  it('should carry the tree roles the pattern needs', () => {
    // Given
    const document_ = cyclicDocument();
    // The tree lives on the schema page since TX-PARITY-UI: the response rows link there
    // instead of expanding inline, so the viewer is asserted where it draws.
    const host = mount(buildPageModel(document_, { schemaId: 'Node', markdown }));

    // When
    const tree = host.querySelector('[role="tree"]');
    const item = host.querySelector('[role="treeitem"]');

    // Then
    expect(tree).not.toBeNull();
    expect(item?.getAttribute('aria-level')).toBe('1');
    expect(item?.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('the rail stats row', () => {
  it('should say drift was not measured rather than printing nothing, per SPEC 7.3', () => {
    // Given a document with no health report behind it, which is every document until one is
    // asked for. `FrameStatsModel.drift` is null, and zero is a different statement.
    const page = buildPageModel(smallDocument(), { markdown });
    expect(
      page.frame.stats.drift,
      'the fixture gained a report and this case lost its subject',
    ).toBe(null);

    // When
    const host = mount(page);

    // Then the cell says so in words. It used to draw nothing, which is exactly what a measured
    // clean document would draw if the figure were a warning glyph. It is a count, so it is not.
    const cell = host.querySelector('.oref-nav-stats .oref-nav-stats-missing');
    expect(cell?.textContent).toBe('drift not measured');
    expect(host.querySelector('.oref-nav-stats-drift')).toBeNull();
  });

  it('should print the figure, zero included, once something has measured it', () => {
    // Given the same document with a report that found nothing
    const page = buildPageModel(smallDocument(), { markdown });
    const measured = {
      ...page,
      frame: { ...page.frame, stats: { ...page.frame.stats, drift: 0 } },
    };

    // When
    const host = mount(measured);

    // Then the two states are told apart at the same place on the page
    expect(host.querySelector('.oref-nav-stats-drift')?.textContent).toBe('▲ 0');
    expect(host.querySelector('.oref-nav-stats-missing')).toBeNull();
  });
});

describe('the virtualized sidebar', () => {
  it('should bind its scroll handler to the element the stylesheet made scrollable', () => {
    // Given the rail laid out the way the shipped theme lays it out
    layOutLikeTheTheme();

    // When
    const host = mount(buildPageModel(largeDocument(1000), { markdown }));

    // Then the handler is on the sidebar and not on the block inside it, which is the element
    // that was listened to for five milestones and never fired once.
    const bound = boundScroller();
    expect(bound.classList.contains('oref-sidebar')).toBe(true);
    expect(host.querySelector('.oref-nav-scroll')?.hasAttribute('data-oref-nav-scroller')).toBe(
      false,
    );
  });

  it('should keep the rows in the document under the ceiling while it is scrolled', async () => {
    // Given, the corpus scale in one document: a thousand operations and their groups.
    layOutLikeTheTheme();
    const page = buildPageModel(largeDocument(1000), { markdown });
    const host = mount(page);
    const scroll = boundScroller();
    const counts: number[] = [];

    // When
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      scrollTo(scroll, 20_000 * fraction);
      await Promise.resolve();
      counts.push(host.querySelectorAll('.oref-nav-item').length);
    }

    // Then
    expect(Math.max(...counts)).toBeLessThanOrEqual(NAV_MAX_ROWS);
    expect(new Set(counts).size).toBeGreaterThan(0);
  });

  it('should move the window when the container is scrolled', async () => {
    // Given a page deep in the list, so the sidebar carries the whole of one group rather than
    // the twenty one headers an overview carries, which is fewer rows than a chunk.
    layOutLikeTheTheme();
    const document_ = largeDocument(1000);
    const nodeId = [...document_.nodes.keys()][900] ?? '';
    const page = buildPageModel(document_, { nodeId, markdown });
    const host = mount(page);
    const scroll = boundScroller();

    // WHICH CHUNKS ARE RENDERED IS WHAT THE WINDOW IS. Comparing the first visible row instead
    // reports a moved window only when it moved far enough to change the row at the top, which
    // depends on how many chunks the page happens to have.
    const rendered = (): string[] =>
      Array.from(host.querySelectorAll('.oref-nav-list.oref-nav-rendered')).map(
        (list) => list.getAttribute('data-oref-chunk') ?? '',
      );

    const before = rendered();

    // When the reader scrolls to the bottom
    scrollTo(scroll, 20_000);
    await Promise.resolve();

    // Then
    expect(rendered()).not.toEqual(before);
  });

  it('should open the window on the entry the page is about', () => {
    // Given, a reader arriving at an operation deep in the list should see it in the sidebar.
    const document_ = largeDocument(1000);
    const nodeId = [...document_.nodes.keys()][900] ?? '';

    // When
    const host = mount(buildPageModel(document_, { nodeId, markdown }));
    const active = host.querySelector('.oref-nav-item.oref-active');

    // Then
    expect(active).not.toBeNull();
    expect(active?.getAttribute('aria-current')).toBe('page');
  });
});

describe('the command palette', () => {
  it('should open on the shortcut and close on escape', async () => {
    // Given
    const host = mount(buildPageModel(smallDocument(), { markdown }));

    // When
    press(document, 'k', { metaKey: true });
    await Promise.resolve();
    const opened = host.querySelector('[role="dialog"]');
    press(document, 'Escape');
    await Promise.resolve();

    // Then
    expect(opened).not.toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('should render nothing but the trigger while it is closed', () => {
    // Given, a hidden dialog is markup on every page for a feature most readers never open.
    const host = mount(buildPageModel(largeDocument(1000), { markdown }));

    // Then
    expect(host.querySelector('.oref-palette-open')).not.toBeNull();
    expect(host.querySelectorAll('.oref-palette-hit')).toHaveLength(0);
  });

  it('should walk from the search key to an operation to a schema field with no pointer', async () => {
    // Given, the keyboard path BUILD T012 asks for, end to end and in one test, because each leg
    // of it working separately is not the same as the path working.
    const document_ = cyclicDocument();
    const host = mount(buildPageModel(document_, { markdown }), document_);

    // When, the reader opens the palette, which fetches the rest of the index, and types.
    press(document, 'k', { ctrlKey: true });
    await Promise.resolve();
    await Promise.resolve();

    const input = host.querySelector<HTMLInputElement>('.oref-palette-input')!;
    input.value = 'nodes';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    // ... moves the selection and presses enter, which focuses the link it selected.
    press(input, 'ArrowDown');
    await Promise.resolve();
    press(input, 'Enter');
    await Promise.resolve();

    const link = document.activeElement as HTMLAnchorElement | null;
    const hits = host.querySelectorAll('.oref-palette-hit').length;
    const followed = link?.classList.contains('oref-palette-link') === true;

    // ... and lands on the page that link names, where the schema tree takes the keyboard.
    const target = link?.getAttribute('href')?.split('/').at(-1) ?? '';
    mounted?.unmount();
    const next = mount(buildPageModel(document_, { nodeId: decodeURIComponent(target), markdown }));
    const row = next.querySelector('.oref-schema-row');
    focusElement(row);
    press(row, 'ArrowDown');
    await Promise.resolve();

    // Then
    expect(hits).toBeGreaterThan(0);
    expect(followed).toBe(true);
    expect(document_.nodes.has(decodeURIComponent(target))).toBe(true);
    expect(
      (document.activeElement as HTMLElement | null)?.classList.contains('oref-schema-row'),
    ).toBe(true);
  });

  it('should carry the combobox roles the pattern needs', async () => {
    // Given
    const host = mount(buildPageModel(smallDocument(), { markdown }));

    // When
    press(document, 'k', { metaKey: true });
    await Promise.resolve();
    const input = host.querySelector('.oref-palette-input');

    // Then
    expect(input?.getAttribute('role')).toBe('combobox');
    expect(input?.getAttribute('aria-controls')).toBe(
      host.querySelector('[role="listbox"]')?.getAttribute('id'),
    );
  });
});

/**
 * Findings F15 and F19, which are one defect a layer apart: two components each own a piece of
 * the same header, and neither asks whether the other has already said it.
 *
 * They are here rather than beside the markup tests because what they assert is what a reader
 * sees on the assembled page. Each was measured in a browser on the demo before it was written
 * down: `List orders` as a heading and again as a subtitle, `application/json array` above a row
 * reading `application/json array`, and `ProblemDto ProblemDto` on one row of the schema tree.
 */
describe('a page that says each thing once', () => {
  it('should make the address the heading and the summary its meta line, per TX-PARITY-UI', () => {
    // Given an operation with a summary and no title of its own, which is most operations and
    // is what `@nestjs/swagger` writes. Since the layout's order landed, the heading is the
    // method badge and the path, and the summary always says something the address does not,
    // so it stands in the meta line rather than vanishing under the old title dedupe.
    const host = mount(buildPageModel(smallDocument(), { nodeId: 'get-orders', markdown }));

    // When
    const title = host.querySelector('.oref-operation-title')?.textContent ?? '';
    const subtitle = host.querySelector('.oref-operation-meta .oref-subtitle');

    // Then
    expect(title).toContain('GET');
    expect(title).toContain('/orders');
    expect(subtitle?.textContent).toBe('List orders');
  });

  it('should print a summary that differs from the title', () => {
    // Given the same page with a title of its own; the heading is the address either way, so
    // the summary keeps saying what the heading does not.
    const page = buildPageModel(smallDocument(), { nodeId: 'get-orders', markdown });
    const node = page.node;
    if (node === null) throw new Error('the fixture page has no node');

    // When
    const host = mount({ ...page, node: { ...node, title: 'Orders, newest first' } });

    // Then
    expect(host.querySelector('.oref-operation-title')?.textContent).toContain('/orders');
    expect(host.querySelector('.oref-subtitle')?.textContent).toBe('List orders');
  });

  it('should let the media block name the media type and the tree name the schema', () => {
    // Given a request body that names a schema, which is where a media block still draws a
    // tree: the response blocks became the compact index with TX-PARITY-UI.
    const host = mount(buildPageModel(smallDocument(), { nodeId: 'post-orders', markdown }));

    // When
    const head = host.querySelector('.oref-media-head')?.textContent ?? '';
    const root = host.querySelector('.oref-schema-tree .oref-schema-row')?.textContent ?? '';

    // Then the head says what it is written in, the root row says what shape it has, and
    // neither says the other's word.
    expect(head).toBe('application/json');
    expect(root).toContain('Order');
  });

  it('should print a named schema once on the row where it is both the name and the type', () => {
    // Given a body that is a reference to a named schema. The type of such a position is the
    // schema's name, so the row had the same string in both of its slots.
    const host = mount(buildPageModel(smallDocument(), { nodeId: 'post-orders', markdown }));

    // When
    const root = host.querySelector('.oref-schema-tree .oref-schema-row');
    const text = root?.textContent ?? '';

    // Then
    expect(text).toContain('Order');
    expect(text.match(/Order/g) ?? []).toHaveLength(1);
  });
});

describe('the page frame', () => {
  it('should put a skip link first, pointing at the content', () => {
    // Given, a skip link that is not first in the tab order does nothing for the reader it is
    // there for.
    const host = mount(buildPageModel(smallDocument(), { markdown }));

    // When
    const first = host.querySelector('a');
    const main = host.querySelector('main');

    // Then
    expect(first?.classList.contains('oref-skip')).toBe(true);
    expect(first?.getAttribute('href')).toBe(`#${main?.id ?? ''}`);
  });

  it('should write no inline style anywhere in the rendered document', () => {
    // Given, STANDARDS 10: a nonce can never authorize a style attribute, and the reference
    // works under style-src 'self' with no unsafe-inline. The gate scans built files; this is
    // the same assertion against what a browser actually ends up holding.
    const host = mount(buildPageModel(cyclicDocument(), { markdown }));

    // When
    const styled = host.querySelectorAll('[style]');

    // Then, a host that rendered nothing carries no style attribute either, per SPEC 0
    expect(host.querySelector('.oref-root')).not.toBeNull();
    expect(host.querySelectorAll('*').length).toBeGreaterThan(20);
    expect(styled).toHaveLength(0);
  });
});
