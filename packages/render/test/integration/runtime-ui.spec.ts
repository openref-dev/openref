// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from 'vue';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { buildPageModel, type PageModel } from '../../src/page/domain/page-model';
import { ReferenceApp } from '../../src/components/ReferenceApp';
import { DEFERRABLE_KEY } from '../../src/components/deferrable';
import { EAGER_COMPONENTS } from '../../src/components/eager';
import { runtimeDocument, runtimeNodeId, smallDocument } from '../mocks/documents';

/**
 * The runtime block and the Health panel as a reader meets them, per BUILD T023.
 *
 * WHAT IS ASSERTED HERE IS WHAT A READER CAN TELL APART, not what the markup contains. The three
 * confidence levels of SPEC 6.1 have to be distinguishable by somebody who cannot see colour and
 * by a monochrome printer, so the assertions read the code and the edge style and never the
 * colour; and the block has to be absent rather than empty for a reader who registered no
 * collector, which is most readers.
 *
 * THE EDGE STYLE IS READ OUT OF THE STYLESHEET AND NOT OUT OF A COMPUTED STYLE. jsdom applies no
 * author stylesheet, so a computed style here would report the initial value for every element
 * and pass on any implementation. The theme is a sibling package this one cannot import, so its
 * file is read the way `theme.spec.ts` reads the renderer's.
 */

const markdown = await createMarkdownRenderer();
const THEME_CSS = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'theme',
  'src',
  'styles',
  'theme.css',
);
const TOKENS_CSS = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'theme',
  'src',
  'styles',
  'tokens.css',
);

let mounted: { unmount(): void } | null = null;

function mount(page: PageModel): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);

  const app = createApp(ReferenceApp, { page, basePath: '' });
  app.provide(DEFERRABLE_KEY, EAGER_COMPONENTS);
  app.mount(host);
  mounted = app;

  return host;
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

/** The declarations of one rule of the theme, comments removed. */
function ruleBody(selector: string): string {
  const css = readFileSync(THEME_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
  const pattern = new RegExp(`(^|,)\\s*\\${selector}\\s*(,[^{}]*)?\\{([^{}]*)\\}`, 'mu');

  return pattern.exec(css)?.[3] ?? '';
}

describe('the runtime block on an operation page', () => {
  it('should render nothing at all when no collector reached the application', () => {
    // Given a document normalized outside any application, which is what a reader arriving from
    // plain @nestjs/swagger has. SPEC 6.3: a scaffold of labelled slots with dashes in them reads
    // as a broken product rather than as a feature nobody switched on.
    const page = buildPageModel(smallDocument(), { markdown, nodeId: runtimeNodeId() });

    // When
    const host = mount(page);

    // Then, no block, no columns, and no empty second column beside the specification
    expect(host.querySelector('.oref-section-runtime')).toBeNull();
    expect(host.querySelector('.oref-node-columns')).toBeNull();
    expect(host.querySelector('.oref-runtime')).toBeNull();
  });

  it('should put the specification and the runtime in two columns when there are facts', () => {
    // Given, vernier's thesis: what is declared and what is observed stand side by side
    const page = buildPageModel(runtimeDocument(), { markdown, nodeId: runtimeNodeId() });

    // When
    const host = mount(page);

    // Then
    expect(host.querySelector('.oref-node-columns')).not.toBeNull();
    expect(host.querySelector('.oref-column-spec .oref-section-responses')).not.toBeNull();
    expect(host.querySelector('.oref-column-runtime .oref-section-runtime')).not.toBeNull();
  });

  it('should show every fact SPEC 2 promises, in the words that block uses', () => {
    // Given, the block the README opens with in T063
    const page = buildPageModel(runtimeDocument(), { markdown, nodeId: runtimeNodeId() });

    // When
    const host = mount(page);
    const labels = Array.from(host.querySelectorAll('.oref-runtime-label')).map(
      (el) => el.textContent,
    );
    const text = host.querySelector('.oref-runtime')?.textContent ?? '';

    // Then
    expect(labels).toContain('Guards');
    expect(labels).toContain('Scopes');
    expect(labels).toContain('Rate limit');
    expect(labels).toContain('Source');
    expect(text).toContain('JwtAuthGuard');
    expect(text).toContain('orders:read');
    expect(text).toContain('100 / minute');
    expect(text).toContain('OrdersController.findAll()');
  });

  it('should link the handler to the line it is written on', () => {
    // Given, the feature SPEC 6.3 calls the highest ratio of value to cost in the product
    const page = buildPageModel(runtimeDocument(), { markdown, nodeId: runtimeNodeId() });

    // When
    const link = mount(page).querySelector('.oref-source-link');

    // Then
    expect(link?.getAttribute('href')).toBe(
      'https://github.com/org/repo/blob/abc123/src/orders.controller.ts#L42',
    );
  });
});

describe('the three confidence levels', () => {
  it('should carry a three letter code that survives a monochrome print', () => {
    // Given, SPEC 6.1: the levels are told apart by a code and by an edge style, and colour is
    // the third carrier and the only optional one.
    const page = buildPageModel(runtimeDocument(), { markdown, nodeId: runtimeNodeId() });

    // When
    const codes = Array.from(mount(page).querySelectorAll('.oref-prov')).map(
      (el) => el.textContent,
    );

    // Then all three levels appear, each as its own code
    expect(new Set(codes)).toEqual(new Set(['DCL', 'DRV', 'INF']));
  });

  it('should name the level and the collector in words for a reader who cannot see it', () => {
    // Given, a three letter code is a code, so the mark carries its expansion. `abbr` with a
    // title is the element the language already has for exactly that.
    const page = buildPageModel(runtimeDocument(), { markdown, nodeId: runtimeNodeId() });

    // When
    const marks = Array.from(mount(page).querySelectorAll('.oref-prov'));

    // Then
    expect(marks.every((mark) => mark.tagName.toLowerCase() === 'abbr')).toBe(true);
    expect(marks.map((mark) => mark.getAttribute('title'))).toContain('declared, scopesCollector');
    expect(marks.every((mark) => (mark.getAttribute('title') ?? '').includes(', '))).toBe(true);
  });

  it('should give each level its own class, so a stylesheet can tell them apart', () => {
    // Given
    const page = buildPageModel(runtimeDocument(), { markdown, nodeId: runtimeNodeId() });

    // When
    const classes = Array.from(mount(page).querySelectorAll('.oref-prov')).map((el) =>
      Array.from(el.classList).find((name) => name !== 'oref-prov'),
    );

    // Then
    expect(new Set(classes)).toEqual(
      new Set(['oref-prov-declared', 'oref-prov-derived', 'oref-prov-inferred']),
    );
  });

  it('should draw a different edge style per level, so colour is never the only difference', () => {
    // Given the default theme, whose rules the renderer cannot import and this test reads
    const tokens = readFileSync(TOKENS_CSS, 'utf8');

    // When, the style each level's rule asks for, resolved through the token it names
    const styles = ['declared', 'derived', 'inferred'].map((level) => {
      const declared = ruleBody(`.oref-prov-${level}`);
      const token = new RegExp(`--oref-prov-${level}-border-style:\\s*([a-z]+)`, 'u').exec(tokens);

      return declared.includes(`--oref-prov-${level}-border-style`) ? (token?.[1] ?? '') : '';
    });

    // Then three distinct styles, none of them empty
    expect(styles).toEqual(['solid', 'dashed', 'dotted']);
    expect(new Set(styles).size).toBe(3);
  });
});

describe('the Health panel', () => {
  it('should not exist on a document nothing measured', () => {
    // Given, SPEC 7.3: a score of zero says the documentation is bad, and no panel says nothing
    // looked at it.
    const page = buildPageModel(smallDocument(), { markdown });

    // When
    const host = mount(page);

    // Then
    expect(host.querySelector('.oref-section-health')).toBeNull();
  });

  it('should live on the overview and not on a node page', () => {
    // Given the same document, opened twice
    const document = runtimeDocument();

    // When
    const overview = mount(buildPageModel(document, { markdown }));
    const overviewHasPanel = overview.querySelector('.oref-section-health') !== null;
    mounted?.unmount();
    document_reset();
    const node = mount(buildPageModel(document, { markdown, nodeId: runtimeNodeId() }));

    // Then
    expect(overviewHasPanel).toBe(true);
    expect(node.querySelector('.oref-section-health')).toBeNull();
  });

  it('should list rules rather than findings, so four hundred findings are ten rows', () => {
    // Given, the panel has to be readable at both extremes the task names
    const page = buildPageModel(runtimeDocument(), { markdown });

    // When
    const host = mount(page);
    const groups = Array.from(host.querySelectorAll('.oref-rule'));
    const findings = Array.from(host.querySelectorAll('.oref-drift'));

    // Then, one disclosure per rule, closed, and every finding inside one
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.length).toBeLessThan(findings.length + 1);
    expect(groups.every((group) => group.tagName.toLowerCase() === 'details')).toBe(true);
    expect(groups.every((group) => !group.hasAttribute('open'))).toBe(true);
  });

  it('should open a group without any script, which is what keeps it under a strict CSP', () => {
    // Given, the disclosure is the user agent's own. A filter written in script would be the same
    // feature at the price of bytes in the first paint and a handler to authorize.
    const page = buildPageModel(runtimeDocument(), { markdown });

    // When
    const group = mount(page).querySelector('details.oref-rule');
    const summary = group?.querySelector('summary');

    // Then
    expect(summary).not.toBeNull();
    expect(summary?.classList.contains('oref-rule-head')).toBe(true);
  });

  it('should say what each rule found and how to fix each finding', () => {
    // Given, SPEC 7.2: a finding without its edit tells a reader something is wrong and leaves
    // them to work out what to do about it.
    const page = buildPageModel(runtimeDocument(), { markdown });

    // When
    const host = mount(page);
    const fixes = Array.from(host.querySelectorAll('.oref-drift-fix'));
    const counts = Array.from(host.querySelectorAll('.oref-rule-count'));

    // Then
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes.every((fix) => fix.textContent.length > 0)).toBe(true);
    expect(counts.every((count) => Number(count.textContent) > 0)).toBe(true);
  });

  it('should give every finding a jump to the node it is about', () => {
    // Given
    const page = buildPageModel(runtimeDocument(), { markdown, basePath: '/docs' });

    // When
    const jumps = Array.from(mount(page).querySelectorAll('.oref-drift-subject'));

    // Then
    expect(jumps.length).toBeGreaterThan(0);
    expect(jumps.every((jump) => (jump.getAttribute('href') ?? '').startsWith('/docs/'))).toBe(
      true,
    );
  });
});

/** Clears the body between two mounts inside one case. */
function document_reset(): void {
  document.body.innerHTML = '';
}
