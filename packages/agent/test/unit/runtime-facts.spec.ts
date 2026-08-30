import { describe, expect, it } from 'vitest';
import { buildLlmsFull, plainSummary, SUMMARY_LIMIT, type LlmsTextOptions } from '../../src/index';
import { documentWithFacts, orderDocument } from '../mocks/documents';

const mounted: LlmsTextOptions = { basePath: '/docs', agent: { llmsTxt: true, mcp: false } };

describe('the runtime facts llms-full.txt prints', () => {
  it('should print every fact with its confidence and the collector that produced it', () => {
    // Given a document a collector pass ran over, per SPEC 6.1: a value with no provenance is not
    // representable, and a machine reader of these lines is deciding what to trust
    const document = documentWithFacts();

    // When
    const full = buildLlmsFull(document, mounted);

    // Then
    expect(full).toContain('- scopes: orders:read (declared, scopesCollector)');
    expect(full).toContain('- roles: support (derived, rolesCollector)');
    expect(full).toContain('- rate limit: 10 per 60000 ms (derived, throttlerCollector)');
    expect(full).toContain('- timeout: 5000 ms (derived, timeoutCollector)');
    expect(full).toContain('- required headers: x-tenant (derived, headersCollector)');
    expect(full).toContain('- success status: 200 (declared, declarationsCollector)');
    expect(full).toContain('- streaming: sse of Order (declared, streamCollector)');
    expect(full).toContain('- guard: JwtAuthGuard (derived, guardsCollector)');
  });

  it('should name which collectors ran, once, at the top', () => {
    // Given
    const document = documentWithFacts();

    // When
    const full = buildLlmsFull(document, mounted);

    // Then
    expect(full).toContain('Runtime facts were collected by: scopesCollector, throttlerCollector.');
    expect(full).toContain('carries its confidence and the collector that produced it');
  });

  it('should say a pass ran and stated nothing rather than leaving the reader to guess', () => {
    // Given a document a pass ran over, where one operation gathered no fact at all: "no fact"
    // and "no pass" are different, and only a document with a pass can carry the first
    const document = documentWithFacts();

    // When
    const full = buildLlmsFull(document, mounted);

    // Then
    expect(full).toContain('Runtime: no collector stated anything about this operation.');
  });

  it('should say nothing about runtime at all on a document no pass ever touched', () => {
    // Given, the presence half of the case above: without it, the sentence and its absence would
    // be indistinguishable
    const document = orderDocument();
    expect(document.runtime).toBeUndefined();

    // When
    const full = buildLlmsFull(document, mounted);

    // Then
    expect(full).not.toContain('Runtime');
  });
});

describe('plainSummary', () => {
  it('should cut a long description at a word boundary and mark the cut', () => {
    // Given a description longer than the limit
    const written = `${'word '.repeat(80)}end`;

    // When
    const summary = plainSummary(written);

    // Then, cutting mid word would produce a fragment a reader cannot resolve
    expect(summary.length).toBeLessThanOrEqual(SUMMARY_LIMIT + 3);
    expect(summary.endsWith('...')).toBe(true);
    expect(summary).not.toContain('  ');
  });

  it('should cut at the limit when the text carries no space to cut at', () => {
    // Given, a single token longer than the limit, which has no word boundary to find
    const written = 'x'.repeat(SUMMARY_LIMIT + 50);

    // When
    const summary = plainSummary(written);

    // Then
    expect(summary).toBe(`${'x'.repeat(SUMMARY_LIMIT)}...`);
  });

  it('should flatten a fenced block, an image and a link to what a reader would read', () => {
    // Given
    const written = '# Title\n\n```ts\nconst a = 1;\n```\n\n![alt](a.png) and [text](https://x)';

    // When
    const summary = plainSummary(written);

    // Then
    expect(summary).toBe('Title alt and text');
  });
});
