import { OpenRefError } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { assertNonce, renderHtmlDocument, STATE_ELEMENT_ID } from '../../src/page/domain/shell';
import type { RenderedPage } from '../../src/cache/application/ports/render-cache.port';

function page(overrides: Partial<RenderedPage> = {}): RenderedPage {
  return {
    documentHash: 'abc',
    nodeId: null,
    title: 'Orders API',
    appHtml: '<div class="oref-root"></div>',
    stateJson: '{"a":1}',
    ...overrides,
  };
}

describe('renderHtmlDocument', () => {
  it('should put the nonce on every script element it writes', () => {
    // Given
    const nonce = 'r4nd0mNONCEvalue';

    // When
    const html = renderHtmlDocument(page(), {
      nonce,
      assets: { modules: ['/assets/openref.js'] },
    });

    // Then
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts).toHaveLength(2);
    expect(scripts.every((tag) => tag.includes(`nonce="${nonce}"`))).toBe(true);
  });

  it('should write an empty nonce attribute when the host serves no nonce policy', () => {
    // Given
    const options = { assets: { modules: ['/assets/openref.js'] } };

    // When
    const html = renderHtmlDocument(page(), options);

    // Then
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts).toHaveLength(2);
    expect(scripts.every((tag) => tag.includes('nonce=""'))).toBe(true);
  });

  it('should refuse a nonce that would break out of the attribute', () => {
    // Given
    const nonce = 'abc" onload="alert(1)';

    // When
    const act = (): string => renderHtmlDocument(page(), { nonce });

    // Then
    expect(act).toThrow(OpenRefError);
  });

  it('should refuse a nonce that is too short to be one', () => {
    // Given
    const nonce = 'abc';

    // When
    const act = (): string => assertNonce(nonce);

    // Then
    expect(act).toThrow(OpenRefError);
  });

  it('should link stylesheets externally rather than inlining them', () => {
    // Given
    const assets = { stylesheets: ['/assets/tokens.css', '/assets/theme.css'] };

    // When
    const html = renderHtmlDocument(page(), { assets });

    // Then
    expect(html).toContain('<link rel="stylesheet" href="/assets/tokens.css">');
    expect(html).toContain('<link rel="stylesheet" href="/assets/theme.css">');
    expect(html).not.toContain('<style');
  });

  it('should escape the title rather than letting a document title write markup', () => {
    // Given
    const hostile = page({ title: '</title><script>globalThis.pwned = true;</script>' });

    // When
    const html = renderHtmlDocument(hostile);

    // Then
    expect(html).not.toContain('<script>globalThis');
    expect(html).toContain('&lt;/title&gt;');
  });

  it('should escape a closing script sequence inside the state block', () => {
    // Given
    const hostile = page({
      stateJson: '{"x":"</script><script>globalThis.pwned = true;</script>"}',
    });

    // When
    const html = renderHtmlDocument(hostile);

    // Then
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts).toHaveLength(1);
    expect(html).toContain('\\u003c/script');
  });

  it('should carry the state under a known id so the client can find it', () => {
    // Given
    const rendered = page({ stateJson: '{"pageModelVersion":1}' });

    // When
    const html = renderHtmlDocument(rendered);

    // Then
    expect(html).toContain(`id="${STATE_ELEMENT_ID}"`);
    expect(html).toContain('"pageModelVersion":1');
  });

  it('should write the forced colour scheme as a data attribute', () => {
    // Given
    const options = { colorScheme: 'dark' as const };

    // When
    const html = renderHtmlDocument(page(), options);

    // Then
    expect(html).toContain('data-oref-color-scheme="dark"');
  });

  it('should carry no style attribute anywhere in the document it assembles', () => {
    // Given
    const rendered = page();

    // When
    const html = renderHtmlDocument(rendered, {
      nonce: 'r4nd0mNONCEvalue',
      assets: { stylesheets: ['/a.css'], modules: ['/b.js'] },
    });

    // Then
    expect(/[\s'"`;{(]style\s*=/.test(html)).toBe(false);
  });
});
