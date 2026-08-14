import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import telltale from '../../src/theme';
import { entryHref, nodeHref, overviewHref, schemaHref } from '../../src/links';
import { apiDocument, nodeId, postNodeId, runtimeDocument } from '../mocks/documents';
import { createMarkdownRenderer } from '../../../render/src/markdown/domain/markdown';
import {
  nodeHref as referenceNodeHref,
  overviewHref as referenceOverviewHref,
  schemaHref as referenceSchemaHref,
} from '../../../render/src/page/domain/links';
import { renderPage } from '../../../render/src/render/application/services/render.service';

/**
 * Where this theme ends and the reference begins, measured rather than argued.
 *
 * THIS FILE IS THE DELIVERABLE OF T032 AS MUCH AS THE THEME IS. The task exists to prove the theme
 * contract is real, and a proof that comes back partly negative is a result. `THEME-BOUNDARY.md`
 * beside the package README says what each of these means and who owns it; this file is what stops
 * the answer drifting without anybody noticing.
 *
 * NOTHING HERE IS WORKED AROUND. Every case pins a fact about the boundary as it is, so that the
 * task that changes the boundary sees these go red and has to read them.
 */

const markdown = await createMarkdownRenderer();

/** Class names from the reference's own namespace that survive a complete L2 theme. */
async function survivingCoreClasses(): Promise<readonly string[]> {
  const found = new Set<string>();
  const document = apiDocument();

  // The overview is rendered from the document with an application behind it, because the Health
  // panel is drawn only when there is a report, and a sweep that missed it would report a smaller
  // boundary than the one that exists.
  const pages = [
    { document: runtimeDocument(), where: { nodeId: nodeId() } },
    { document, where: { nodeId: postNodeId() } },
    { document: runtimeDocument(), where: {} },
    { document, where: { schemaId: 'Order' } },
  ];

  for (const page of pages) {
    const rendered = await renderPage(page.document, {
      ...page.where,
      markdown,
      theme: telltale,
    });

    for (const match of rendered.appHtml.matchAll(/class="([^"]*)"/g)) {
      for (const name of (match[1] ?? '').split(/\s+/)) {
        if (name.startsWith('oref-')) found.add(name);
      }
    }
  }

  return [...found].sort();
}

describe('the markup a complete L2 theme does not own', () => {
  it('should be exactly these class names, on the four pages a reader can open', async () => {
    // Given a theme that fills all 21 positions of the frozen registry and writes its own
    // stylesheet, which is what SPEC 10.1 calls a level 2 theme: "a package with its own layout;
    // the core contributes no styles".
    // When
    const surviving = await survivingCoreClasses();

    // Then the core contributes markup, under its own class names, that this theme did not write
    // and cannot replace. The list is pinned rather than counted so that a name arriving or
    // leaving is read rather than absorbed.
    // `oref-node-columns`, `oref-column-spec` and `oref-column-runtime` left this list with
    // TX-GUTTER: the page-level columns are gone from the reference, the spec and runtime pair
    // exists only inside a parity row, and the parity markup itself lives in the `RuntimePanel`
    // position, which this theme overrides, so no parity class arrives to survive.
    expect(surviving).toEqual([
      'oref-code',
      'oref-description',
      'oref-example',
      'oref-field',
      'oref-field-control',
      'oref-field-label',
      'oref-field-note',
      'oref-media',
      'oref-media-head',
      'oref-media-type',
      'oref-operation',
      'oref-root',
      'oref-section',
      'oref-section-health',
      'oref-section-request',
      'oref-section-security',
      'oref-section-title',
      'oref-section-tryit',
      'oref-security-item',
      'oref-security-list',
      'oref-security-type',
      'oref-tryit-form',
    ]);
  });

  it('should force this theme to style class names it did not author', async () => {
    // Given the stylesheet this theme ships, and the class names the reference leaves on the page.
    const css = readFileSync(
      join(import.meta.dirname, '..', '..', 'src', 'styles', 'theme.css'),
      'utf8',
    );
    const surviving = await survivingCoreClasses();

    // Two are deliberately not styled, and saying which is the point: `oref-root` and
    // `oref-section-health` are the two elements this theme does reach inside, one through
    // `display: contents` and one because the health position is its own.
    const styled = surviving.filter((name) => css.includes(`.${name}`));

    // When
    const unstyled = surviving.filter((name) => !styled.includes(name));

    // Then every one of them is either styled here or named as deliberately not. A class that
    // arrived and was styled by nobody is an unstyled region on a page a reader opens, and it
    // would look exactly like a theme that had not been finished.
    expect(unstyled).toEqual(['oref-section-health']);
    expect(styled.length).toBeGreaterThan(20);
  });

  it('should include two whole blocks of content that have no position at all', async () => {
    // Given, the security requirements of an operation and its request body are drawn entirely by
    // the reference. Not the frame around a position: the content.
    const html = (
      await renderPage(apiDocument(), { nodeId: postNodeId(), markdown, theme: telltale })
    ).appHtml;

    // When, Then the scheme id, its type and the heading over it are all the reference's markup on
    // a page where every registry position is this theme's
    expect(html).toContain('<h2 class="oref-section-title">Security</h2>');
    expect(html).toContain('<span class="oref-security-type">apiKey</span>');
    expect(html).toContain('<h2 class="oref-section-title">Request body</h2>');
  });

  it('should receive the runtime block ahead of the specification, which is this theme thesis', async () => {
    // Given, telltale's handoff says in its first line what it does that the other two directions
    // do not: the runtime block comes before the specification rather than after it. That order is
    // decided inside `NodePanel`, which is not a slot, and the shell is handed the page as opaque
    // children, so no position of the contract can express it. Until TX-GUTTER this theme undid
    // the reference's column order in CSS with `column-reverse`; the parity scale put the runtime
    // block directly after the header, so the document order now IS this theme's order, and the
    // reading order a screen reader follows finally matches what the CSS used to fake.
    const html = (
      await renderPage(runtimeDocument(), { nodeId: nodeId(), markdown, theme: telltale })
    ).appHtml;

    // When, the runtime position resolves to this theme's own block
    const runtime = html.indexOf('tt-runtime');
    const description = html.indexOf('oref-description');

    // Then the runtime block precedes the prose in the document itself
    expect(runtime).toBeGreaterThan(-1);
    expect(description).toBeGreaterThan(runtime);
  });

  it('should require the health position to write a class from the reference namespace', async () => {
    // Given, the browser fills the health position with `h('section', { class:
    // 'oref-section-health' })` and nothing else, so hydration compares the class list against
    // exactly that one name.
    const html = (await renderPage(runtimeDocument(), { markdown, theme: telltale })).appHtml;

    // When, Then this theme's override writes that class, alone, and puts its own class inside.
    // A root carrying both would have this theme's class patched away on hydration, silently, in a
    // browser and nowhere else.
    expect(html).toContain('<section class="oref-section-health"><div class="tt-health">');
  });

  it('should build every link by transcribing a route table it cannot import', () => {
    // Given, `NavTree` is handed `nodeId`, `schemaId` and `basePath` and has to build the href;
    // `CommandPalette` is handed hits that already carry one. So one position of the contract gets
    // the answer and the other gets the parts, and assembling the parts means knowing the
    // reference's route table, which lives in `@openref/render` and is not published.
    const base = '/docs';

    // When, Then this theme's three rules agree with the three the reference serves. This case is
    // the only thing that makes a wrong transcription fail: a wrong href is a string, and every
    // other test in this package would pass with all of them broken.
    expect(overviewHref('')).toBe(referenceOverviewHref(''));
    expect(overviewHref(base)).toBe(referenceOverviewHref(base));
    expect(nodeHref('get-orders', base)).toBe(referenceNodeHref('get-orders', base));
    expect(nodeHref('get /a b', base)).toBe(referenceNodeHref('get /a b', base));
    expect(schemaHref('Order', base)).toBe(referenceSchemaHref('Order', base));
    expect(schemaHref('Order__1a2b3c4d', base)).toBe(referenceSchemaHref('Order__1a2b3c4d', base));

    expect(entryHref({ nodeId: 'get-orders', schemaId: null }, base)).toBe(
      referenceNodeHref('get-orders', base),
    );
    expect(entryHref({ nodeId: null, schemaId: 'Order' }, base)).toBe(
      referenceSchemaHref('Order', base),
    );
    expect(entryHref({ nodeId: null, schemaId: null }, base)).toBeNull();
  });

  it('should have to install a package a theme author is not told they need', () => {
    // Given, SPEC 4 says a theme author installs `@openref/vue`. Three of the props the frozen
    // registry declares are IR types, and that package re-exports none of them, so a theme that
    // types the value it is handed reaches for `@openref/core` as well.
    //
    // READ OFF `PUBLIC-API.md` AND NOT OFF THE MODULE. A type has no runtime identity, so
    // `Object.keys` of the imported namespace can never contain one of these names and a case
    // written that way would be green for the wrong reason. That document is the published
    // surface, checked in both directions against `dist/*.d.ts` by T031's own suite.
    const surface = readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'vue', 'PUBLIC-API.md'),
      'utf8',
    );

    // When, Then. The day `@openref/vue` re-exports them this fails, and the `@openref/core`
    // dependency comes out of this package.
    expect(surface, 'PUBLIC-API.md is empty, so this case proves nothing').toContain('SlotName');
    expect(surface).not.toContain('IRConfidence');
    expect(surface).not.toContain('IRSchemaView');

    // And the three are what this package's own source has to import to type its components
    const imports = ['ProvenanceTag.ts', 'SchemaTree.ts', 'media.ts'].map((file) =>
      readFileSync(join(import.meta.dirname, '..', '..', 'src', 'components', file), 'utf8'),
    );

    expect(imports.filter((source) => source.includes("from '@openref/core'"))).toHaveLength(3);
  });
});

describe('the acceptance test of T032, which is an empty diff to every other package', () => {
  it('should be named by nothing in any other package source', () => {
    // Given, the task's definition of done is that the core did not grow to accommodate this
    // theme. A diff is a fact about one session and cannot be committed; what can be committed is
    // the invariant the diff was protecting: no other package knows this one exists.
    //
    // IT WALKS `packages/` FROM DISK rather than listing the packages it checks, because a list
    // written by hand is accurate exactly as long as the hand, and a package added later would be
    // outside the sweep with nothing red.
    const root = join(import.meta.dirname, '..', '..', '..');
    const others = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'theme-telltale')
      .map((entry) => join(root, entry.name, 'src'));

    // When
    const naming: string[] = [];
    let scanned = 0;

    const visit = (directory: string): void => {
      let entries;
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(path);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;

        scanned += 1;
        if (readFileSync(path, 'utf8').includes('theme-telltale')) naming.push(path);
      }
    };

    for (const directory of others) visit(directory);

    // Then. The count is asserted as well, because a sweep that found no files reports the same
    // empty list as a repository where nothing names this package.
    expect(naming).toEqual([]);
    expect(others.length).toBeGreaterThanOrEqual(11);
    expect(scanned, 'the sweep read no source files, so it proves nothing').toBeGreaterThan(200);
  });
});
