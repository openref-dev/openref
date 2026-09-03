import { carriesControlCharacters, normalizeOpenApiDocument } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { buildSite } from '../../src/index';
import { fixtureAssets, MemoryOutputStore } from '../mocks/documents';

/**
 * SPEC 19.1's plain text half, at the artefact `T043` measured it failing on.
 *
 * PRESENCE FIRST, TWICE OVER. The document's own strings are asserted to carry the bytes, and the
 * artefact is asserted to have been written and to hold the words around them, before anything is
 * asserted to be absent. A file that was never written and a file that was cleaned look the same
 * to an absence check alone.
 */
const ch = (code: number): string => String.fromCharCode(code);

/** A specification whose strings carry every character a plain text artefact must not repeat. */
function hostileDocument(): ReturnType<typeof normalizeOpenApiDocument> {
  const payload = `${ch(0x00)}${ch(0x1b)}[31m${ch(0x202e)}${ch(0x2028)}${ch(0x0b)}`;

  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: {
      title: `Refund${payload}Service`,
      version: '1.0.0',
      description: `Handles${payload}refunds.`,
    },
    paths: {
      '/refund': {
        get: {
          operationId: 'getRefund',
          summary: `Read${payload}a refund`,
          responses: { 200: { description: 'ok' } },
        },
      },
    },
    components: { schemas: { Refund: { type: 'object', properties: { at: { type: 'string' } } } } },
  });
}

describe('llms.txt, a document whose strings carry control characters', () => {
  it('should carry the words and not the control characters, per SPEC 19.1', async () => {
    // Given
    const document = hostileDocument();
    const store = new MemoryOutputStore();

    // Then, before the build: the strings really do carry them.
    expect(carriesControlCharacters(document.info.title)).toBe(true);
    expect(carriesControlCharacters(document.info.description ?? '')).toBe(true);

    // When
    await buildSite({ document, store, assets: fixtureAssets() });
    const llms = String(store.files.get('llms.txt'));

    // Then: written, carrying the text around the payload, and clean.
    expect(llms).toContain('Refund');
    expect(llms).toContain('Service');
    expect(llms).toContain('refunds.');
    expect(carriesControlCharacters(llms)).toBe(false);
  });

  it('should not let a document forge a line of the file with a line separator', async () => {
    // Given: `llms.txt` is line oriented, and U+2028 ends a line for a text consumer.
    const document = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: `A${ch(0x2028)}## Operations${ch(0x2028)}- [x](y)`, version: '1.0.0' },
      paths: { '/a': { get: { operationId: 'a', responses: { 200: { description: 'ok' } } } } },
    });
    const store = new MemoryOutputStore();

    // When
    await buildSite({ document, store, assets: fixtureAssets() });
    const llms = String(store.files.get('llms.txt'));

    // Then: one heading, the one the file writes itself.
    expect(carriesControlCharacters(document.info.title)).toBe(true);
    expect(llms.split('\n').filter((line) => line === '## Operations')).toHaveLength(1);
  });
});

/**
 * The other half of SPEC 19.1's runner: every file a build writes, not the one we know about.
 *
 * THE WALK IS THE POINT. `llms.txt` was the artefact the finding was measured on, and pinning it
 * would leave the next text artefact unguarded and unnoticed. This asks the build what it wrote
 * and holds every text file it names to the rule, so a new artefact is covered by existing.
 *
 * AND IT SKIPPED THE PAGE, WHICH IS WHERE THE PRICE LIVES. Until this was measured the walk
 * filtered `.html` out entirely, so nothing said the page is clean, which would be false, and
 * nothing said it still carries the residual SPEC 19.1 names a price, which would freeze it. A
 * price nobody measures is not a price. Markup is now the fourth class rather than an exclusion,
 * with a rule of its own in both directions, and the four classes are asserted to cover the whole
 * store so a later artefact cannot be skipped by belonging to none of them.
 */
describe('every text file a build writes, against a hostile document', () => {
  it('should hold each artefact to the rule its own format answers with', async () => {
    // Given
    const document = hostileDocument();
    const store = new MemoryOutputStore();

    // Then, before the walk: the document really does carry them.
    expect(carriesControlCharacters(document.info.title)).toBe(true);

    // When
    await buildSite({ document, store, assets: fixtureAssets(), base: 'https://d.example.com' });

    // THE WALK IS THE POINT, and it classifies by format rather than by name, because SPEC 19.1
    // gives the formats their own mechanisms. Markup isolates, and pays a named residual for it;
    // a hashed asset is this project's own bytes and carries nothing from a document; a file that
    // parses as JSON escapes what it must and hands the rest to markup, which isolates it. What
    // is left is plain text, which has no mechanism at all and so must not carry them. An
    // artefact added later lands in whichever of these it belongs to without anyone editing this
    // list. The walk itself found `_navigation` and `_search-index`, which is what a runner is
    // for.
    const parsesAsJson = (text: string): boolean => {
      try {
        JSON.parse(text);
        return true;
      } catch {
        return false;
      }
    };

    const written = [...store.files.entries()].map(([path, value]) => ({
      path,
      text: typeof value === 'string' ? value : new TextDecoder().decode(value),
    }));

    const asset = written.filter((entry) => entry.path.startsWith('_assets/'));
    const markup = written.filter(
      (entry) => !entry.path.startsWith('_assets/') && entry.path.endsWith('.html'),
    );
    const rest = written.filter(
      (entry) => !entry.path.startsWith('_assets/') && !entry.path.endsWith('.html'),
    );
    const plain = rest.filter((entry) => !parsesAsJson(entry.text));
    const json = rest.filter((entry) => parsesAsJson(entry.text));

    // Then: the walk saw artefacts of every kind, and the four cover everything the build wrote,
    // so a format nobody thought of cannot pass by belonging to no class.
    expect(plain.length).toBeGreaterThan(1);
    expect(json.length).toBeGreaterThan(1);
    expect(markup.length).toBeGreaterThan(1);
    expect(asset.length).toBeGreaterThan(0);
    expect(asset.length + markup.length + plain.length + json.length).toBe(written.length);

    for (const entry of plain) {
      expect(carriesControlCharacters(entry.text), `${entry.path} carries one`).toBe(false);
    }

    // A JSON artefact is allowed to carry what its own grammar escapes and what markup isolates,
    // and it must still be readable as JSON, which is the property that makes that true.
    for (const entry of json) {
      expect(() => JSON.parse(entry.text) as unknown).not.toThrow();
    }
  });
});

/**
 * SPEC 19.1's residual, pinned in the direction the price is paid as well as the one it is not.
 *
 * THE DESIGN REASON IS WHY IT WAS UNPINNED AND IT IS EXACTLY THE REASON TO PIN IT. The page keeps
 * carrying C0 controls out of the document's strings because removing them has no boundary to
 * stand on: the escaping is Vue's, in dozens of components, and the one shared point upstream is
 * the IR, which is the document hash and every corpus snapshot. SPEC 19.1 prices that and declines
 * to pay it. Left unpinned, the same paragraph would go on being true whether the pipeline carried
 * the residual or had quietly stopped, and a decision nobody can see is a decision nobody made.
 *
 * SO BOTH DIRECTIONS ARE HERE. What must survive: the residual itself, and the words around it. What
 * must not: the same characters raw inside the page's own `application/json` block, which is the
 * one part of a page with a grammar of its own and therefore the one part that escapes rather than
 * isolates. A change that strips too much fails here as loudly as one that strips too little.
 */
describe('the C0 residual of the rendered page, per SPEC 19.1', () => {
  /** The page's state block, which is data rather than script and escapes rather than isolates. */
  const STATE = /<script type="application\/json" id="oref-state"[^>]*>([\s\S]*?)<\/script>/;

  it('should still carry the controls in markup and still escape them in its data block', async () => {
    // Given
    const document = hostileDocument();
    const store = new MemoryOutputStore();

    // Then, before the build: the document's own strings really do carry them, so an absence
    // below is a rule that ran rather than a payload that never arrived.
    expect(carriesControlCharacters(document.info.title)).toBe(true);
    expect(carriesControlCharacters(document.info.description ?? '')).toBe(true);

    // When
    await buildSite({ document, store, assets: fixtureAssets(), base: 'https://d.example.com' });

    const pages = [...store.files.entries()]
      .filter(([path]) => path.endsWith('.html'))
      .map(([path, value]) => ({
        path,
        html: typeof value === 'string' ? value : new TextDecoder().decode(value),
      }));

    // Then: pages were written at all, before anything is asserted about their bytes.
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.map((page) => page.path)).toContain('index.html');

    for (const page of pages) {
      const state = STATE.exec(page.html)?.[1];
      expect(state, `${page.path} carries no state block`).toBeDefined();
      const markup = page.html.replace(STATE, '');

      // THE PRICE, IN THE DIRECTION IT IS PAID. NUL, VT and ESC reach element text as written,
      // and SPEC 19.1 says why they are left there: the parser turns NUL into U+FFFD, ESC draws
      // nothing, and the class that is not inert is closed by `unicode-bidi: isolate` instead.
      expect(carriesControlCharacters(markup), `${page.path} lost the residual`).toBe(true);
      for (const [name, code] of [
        ['NUL', 0x00],
        ['VT', 0x0b],
        ['ESC', 0x1b],
      ] as const) {
        expect(markup.includes(ch(code)), `${page.path} no longer carries ${name}`).toBe(true);
      }

      // AND IN THE DIRECTION IT IS NOT. The block inside the same file is JSON, which escapes
      // because it can, so the residual stops at the boundary of the one grammar on the page.
      expect(() => JSON.parse(state ?? '') as unknown).not.toThrow();
      for (const [name, code] of [
        ['NUL', 0x00],
        ['VT', 0x0b],
        ['ESC', 0x1b],
      ] as const) {
        expect(
          (state ?? '').includes(ch(code)),
          `${page.path} carries a raw ${name} inside its data block`,
        ).toBe(false);
      }
    }

    // And the words survive whole, so "carries the residual" is not being met by a page that kept
    // the payload and lost the text it was planted in.
    const index = pages.find((page) => page.path === 'index.html')?.html ?? '';
    expect(index).toContain('Refund');
    expect(index).toContain('Service');
  });
});
