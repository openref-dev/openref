import { describe, expect, it } from 'vitest';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import type { IHighlighter } from '../../src/highlight/domain/highlight';

function countingHighlighter(): IHighlighter & { calls: string[] } {
  const calls: string[] = [];

  return {
    calls,
    languages: ['json'],
    highlight(code, language) {
      calls.push(`${language ?? 'none'}:${code.trim()}`);
      return `<pre class="oref-code"><code><span class="oref-hl-keyword">${code.trim()}</span></code></pre>`;
    },
  };
}

describe('createMarkdownRenderer', () => {
  it('should render markdown to html', () => {
    // Given
    const renderer = createMarkdownRenderer();

    // When
    const result = renderer.render('# Title\n\nSome **bold** text.');

    // Then
    expect(result).toContain('<h1>Title</h1>');
    expect(result).toContain('<strong>bold</strong>');
  });

  it('should produce nothing for an absent or blank description', () => {
    // Given
    const renderer = createMarkdownRenderer();

    // When
    const results = [renderer.render(undefined), renderer.render('   \n  ')];

    // Then
    expect(results).toEqual(['', '']);
  });

  it('should sanitize html written inside markdown', () => {
    // Given
    const renderer = createMarkdownRenderer();

    // When
    const result = renderer.render('Text\n\n<script>globalThis.pwned = true;</script>\n');

    // Then
    expect(result).not.toContain('<script');
    expect(result).toContain('Text');
  });

  it('should sanitize an event handler on an element written inside markdown', () => {
    // Given
    const renderer = createMarkdownRenderer();

    // When
    const result = renderer.render('<img src=x onerror="globalThis.pwned = true">');

    // Then
    expect(result).not.toContain('onerror');
  });

  it('should hand a fenced block to the highlighter with its language', () => {
    // Given
    const highlighter = countingHighlighter();
    const renderer = createMarkdownRenderer({ highlighter });

    // When
    renderer.render('```json\n{"a":1}\n```');

    // Then
    expect(highlighter.calls).toEqual(['json:{"a":1}']);
  });

  it('should treat a fence with no language as having none', () => {
    // Given
    const highlighter = countingHighlighter();
    const renderer = createMarkdownRenderer({ highlighter });

    // When
    renderer.render('```\nplain\n```');

    // Then
    expect(highlighter.calls).toEqual(['none:plain']);
  });

  it('should escape a fenced block when no highlighter was given', () => {
    // Given
    const renderer = createMarkdownRenderer();

    // When
    const result = renderer.render('```html\n<script>alert(1)</script>\n```');

    // Then
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('should sanitize what the highlighter returns, not only what markdown returns', () => {
    // Given
    const hostile: IHighlighter = {
      languages: [],
      highlight: () => '<pre onmouseover="globalThis.pwned = true">x</pre>',
    };
    const renderer = createMarkdownRenderer({ highlighter: hostile });

    // When
    const result = renderer.renderCode('x', 'json');

    // Then
    expect(result).not.toContain('onmouseover');
    expect(result).toContain('x');
  });

  it('should produce the same bytes for the same input twice', () => {
    // Given
    const renderer = createMarkdownRenderer();
    const source = '# T\n\n- a\n- b\n\n```json\n{"a":1}\n```\n';

    // When
    const results = [renderer.render(source), renderer.render(source)];

    // Then
    expect(results[0]).toBe(results[1]);
  });
});
