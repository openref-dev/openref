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
    // gives the three formats three mechanisms. Markup isolates, so the pages are out; a hashed
    // asset is this project's own bytes and carries nothing from a document; a file that parses
    // as JSON escapes what it must and hands the rest to markup, which isolates it. What is left
    // is plain text, which has no mechanism at all and so must not carry them. An artefact added
    // later lands in whichever of these it belongs to without anyone editing this list. The walk
    // itself found `_navigation` and `_search-index`, which is what a runner is for.
    const parsesAsJson = (text: string): boolean => {
      try {
        JSON.parse(text);
        return true;
      } catch {
        return false;
      }
    };

    const decoded = [...store.files.entries()]
      .filter(([path]) => !path.endsWith('.html') && !path.startsWith('_assets/'))
      .map(([path, value]) => ({
        path,
        text: typeof value === 'string' ? value : new TextDecoder().decode(value),
      }));

    const plain = decoded.filter((entry) => !parsesAsJson(entry.text));
    const json = decoded.filter((entry) => parsesAsJson(entry.text));

    // Then: the walk saw artefacts of both kinds, and each is held to its own rule.
    expect(plain.length).toBeGreaterThan(1);
    expect(json.length).toBeGreaterThan(1);

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
