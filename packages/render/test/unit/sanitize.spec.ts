import { describe, expect, it } from 'vitest';
import { HIGHLIGHT_CLASS_PREFIX } from '../../src/highlight/domain/highlight';
import {
  ALLOWED_ATTRIBUTES,
  ALLOWED_NAMESPACED_CLASS_PREFIX,
  ALLOWED_NAMESPACED_CLASSES,
  ALLOWED_TAGS,
  FORBIDDEN_ATTRIBUTES,
  sanitizeHtml,
} from '../../src/markdown/domain/sanitize';

describe('sanitizeHtml', () => {
  it('should remove a script element and keep the prose around it', () => {
    // Given
    const html = '<p>before</p><script>globalThis.pwned = true;</script><p>after</p>';

    // When
    const result = sanitizeHtml(html);

    // Then
    expect(result).not.toContain('script');
    expect(result).toContain('<p>before</p>');
    expect(result).toContain('<p>after</p>');
  });

  it('should remove an event handler attribute and keep the element', () => {
    // Given
    const html = '<img src="x" onerror="globalThis.pwned = true" alt="a">';

    // When
    const result = sanitizeHtml(html);

    // Then
    expect(result).not.toContain('onerror');
    expect(result).toContain('alt="a"');
  });

  it('should remove a style attribute, which a nonce could never authorize', () => {
    // Given
    const html = '<div style="position:fixed;inset:0">covered</div>';

    // When
    const result = sanitizeHtml(html);

    // Then
    expect(result).not.toContain('style');
    expect(result).toContain('covered');
  });

  it('should remove a style element', () => {
    // Given
    const html = '<style>body { display: none }</style><p>kept</p>';

    // When
    const result = sanitizeHtml(html);

    // Then
    expect(result).not.toContain('<style');
    expect(result).toContain('<p>kept</p>');
  });

  it('should drop a javascript url from a link', () => {
    // Given
    const html = '<a href="javascript:globalThis.pwned=true">click</a>';

    // When
    const result = sanitizeHtml(html);

    // Then
    expect(result).not.toContain('javascript:');
    expect(result).toContain('click');
  });

  it('should keep an http link and its text', () => {
    // Given
    const html = '<a href="https://example.com" title="doc">docs</a>';

    // When
    const result = sanitizeHtml(html);

    // Then
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('title="doc"');
  });

  it('should remove a target attribute rather than leaving the host page to deal with it', () => {
    // Given
    const html = '<a href="https://example.com" target="_blank">docs</a>';

    // When
    const result = sanitizeHtml(html);

    // Then
    expect(result).not.toContain('target');
  });

  it('should remove an iframe, an object and a form', () => {
    // Given
    const html =
      '<iframe src="https://evil.example"></iframe>' +
      '<object data="x"></object>' +
      '<form action="/steal"><input name="a"></form>';

    // When
    const result = sanitizeHtml(html);

    // Then
    expect(result).not.toContain('iframe');
    expect(result).not.toContain('object');
    expect(result).not.toContain('<form');
    expect(result).not.toContain('<input');
  });

  it('should keep the markup a markdown renderer produces', () => {
    // Given
    const html =
      '<h2>Title</h2><p><strong>bold</strong> and <em>italic</em></p>' +
      '<ul><li><code>code</code></li></ul>' +
      '<table><thead><tr><th scope="col">h</th></tr></thead><tbody><tr><td>v</td></tr></tbody></table>';

    // When
    const result = sanitizeHtml(html);

    // Then
    expect(result).toContain('<h2>Title</h2>');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<code>code</code>');
    expect(result).toContain('scope="col"');
  });

  it('should keep the classes and the language attribute the highlighter writes', () => {
    // Given
    const html =
      '<pre class="oref-code" data-oref-lang="json"><code><span class="oref-hl-keyword">"a"</span></code></pre>';

    // When
    const result = sanitizeHtml(html);

    // Then
    expect(result).toContain('class="oref-code"');
    expect(result).toContain('data-oref-lang="json"');
    expect(result).toContain('class="oref-hl-keyword"');
  });

  it('should drop a data attribute that is not the one the highlighter writes', () => {
    // Given
    const html = '<p data-anything="x">text</p>';

    // When
    const result = sanitizeHtml(html);

    // Then
    expect(result).not.toContain('data-anything');
    expect(result).toContain('text');
  });

  it('should keep svg out of the allowlist, since svg carries its own script surface', () => {
    // Given
    const allowed = ALLOWED_TAGS;

    // When
    const svg = allowed.filter((tag) => tag === 'svg' || tag === 'math' || tag === 'foreignObject');

    // Then
    expect(svg).toEqual([]);
  });

  it('should never list style among the allowed attributes', () => {
    // Given
    const allowed = ALLOWED_ATTRIBUTES;

    // When
    const forbidden = FORBIDDEN_ATTRIBUTES;

    // Then
    expect(allowed).not.toContain('style');
    expect(forbidden).toContain('style');
  });
});

/**
 * F4 of the T016 adversarial pass, per SPEC 19.1.
 *
 * The execution half of this surface held and is tested above. This is the other half: markup
 * that takes the page without executing anything, by entering the namespace the interface
 * itself lives in.
 */
describe('sanitizeHtml and the interface namespace', () => {
  it('should strip the class that covered the whole viewport', () => {
    // Given, `.oref-palette-scrim` is `position: fixed; inset: 0; z-index: 3` in the default
    // theme. No script, no inline style, and every earlier proof still passed.
    const html = '<div class="oref-palette-scrim">a description that covers the page</div>';

    // When
    const result = sanitizeHtml(html);

    // Then
    expect(result).not.toContain('oref-palette-scrim');
    expect(result).toContain('a description that covers the page');
  });

  it('should strip only the namespaced tokens out of a mixed class attribute', () => {
    // Given
    const html = '<p class="lead oref-sidebar note">text</p>';

    // When
    const result = sanitizeHtml(html);

    // Then
    expect(result).toContain('lead');
    expect(result).toContain('note');
    expect(result).not.toContain('oref-sidebar');
  });

  it('should drop the class attribute entirely when nothing survives', () => {
    // Given
    const html = '<p class="oref-sidebar oref-content">text</p>';

    // When
    const result = sanitizeHtml(html);

    // Then
    expect(result).not.toContain('class=');
    expect(result).toContain('text');
  });

  it('should strip an id that duplicates one the application owns', () => {
    // Given, `oref-app` is the application root and `oref-state` is its state element. A
    // duplicate takes over aria-labelledby, skip links and fragment navigation.
    const html = '<div id="oref-app">a</div><div id="oref-state">b</div>';

    // When
    const result = sanitizeHtml(html);

    // Then
    expect(result).not.toContain('id=');
    expect(result).toContain('a');
    expect(result).toContain('b');
  });

  it('should leave an id outside the namespace alone', () => {
    // Given
    const html = '<h2 id="pagination">Pagination</h2>';

    // When
    const result = sanitizeHtml(html);

    // Then
    expect(result).toContain('id="pagination"');
  });

  it('should keep the classes the markdown pipeline puts on a highlighted block', () => {
    // Given, one sanitizer runs over the prose and over our own highlighter output, so this
    // closed set has to survive. Every member of it is a colour or a font style.
    const html =
      '<pre class="oref-code"><code><span class="oref-hl-line">' +
      '<span class="oref-hl-keyword">const</span></span></code></pre>';

    // When
    const result = sanitizeHtml(html);

    // Then
    expect(result).toContain('oref-code');
    expect(result).toContain('oref-hl-line');
    expect(result).toContain('oref-hl-keyword');
  });

  it('should hold the exception list to what the pipeline actually emits', () => {
    // Given, the exception exists because one sanitizer serves both paths. It is not a place
    // to add a theme class to, which is the drift this rule was written to prevent.
    const allowed = ALLOWED_NAMESPACED_CLASSES;

    // When
    const prefix = ALLOWED_NAMESPACED_CLASS_PREFIX;

    // Then
    expect(allowed).toEqual(['oref-code']);
    expect(prefix).toBe(HIGHLIGHT_CLASS_PREFIX);
  });

  it('should survive a class attribute written with odd whitespace', () => {
    // Given
    const html = '<p class="  oref-sidebar\t\nlead  ">text</p>';

    // When
    const result = sanitizeHtml(html);

    // Then
    expect(result).not.toContain('oref-sidebar');
    expect(result).toContain('lead');
  });
});
