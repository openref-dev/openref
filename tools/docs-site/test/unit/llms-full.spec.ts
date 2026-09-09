import { describe, expect, it } from 'vitest';
import { documentationSpecification, siteLlmsFullText } from '../../src/index.js';

/**
 * The whole reference as text, composed for the root of the published site.
 *
 * THE FILE IS WRITTEN BY THE BUILD AND PROVED HERE, because the two halves fail differently. The
 * build writing a file nobody checks can drift into writing the wrong text; a checked composer
 * nobody writes to disk is a green suite about a file that does not exist. `build.ts` does the
 * writing and fails the build when the composer throws; this suite holds the composer to the
 * document the site is actually built from, so the text and the pages cannot describe two
 * different references.
 */
describe('the whole reference as text', () => {
  const httpMethods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

  /** Every `METHOD /path` pair the composed document declares. */
  function composedOperations(): readonly string[] {
    const specification = documentationSpecification() as {
      readonly paths: Record<string, Record<string, unknown>>;
    };

    return Object.entries(specification.paths).flatMap(([path, item]) =>
      Object.keys(item)
        .filter((key) => httpMethods.includes(key))
        .map((method) => `${method.toUpperCase()} ${path}`),
    );
  }

  it('should be the same bytes on every composition, before anything is proved about them', () => {
    // Given, When
    const first = siteLlmsFullText();
    const second = siteLlmsFullText();

    // Then
    expect(first.length).toBeGreaterThan(0);
    expect(second).toBe(first);
  });

  it('should open with the document and carry the hash a reader can hold it to', () => {
    // Given, When
    const text = siteLlmsFullText();

    // Then
    expect(text.startsWith('# OPENREF\n')).toBe(true);
    expect(text).toMatch(/^Document hash: [0-9a-f]{64}$/m);
  });

  it('should carry every operation the composed document declares, each under its own heading', () => {
    // Given
    const operations = composedOperations();
    expect(operations.length).toBeGreaterThan(10);

    // When
    const text = siteLlmsFullText();

    // Then, one heading per operation, so the text and the route table cannot diverge
    for (const operation of operations) {
      expect(text, `missing: ### ${operation}`).toContain(`### ${operation}`);
    }
    expect([...text.matchAll(/^### /gm)].length).toBe(operations.length);
  });

  it('should carry no em dash and no en dash', () => {
    // Given, When
    const text = siteLlmsFullText();

    // Then
    expect(text.includes('\u2014')).toBe(false);
    expect(text.includes('\u2013')).toBe(false);
  });
});
