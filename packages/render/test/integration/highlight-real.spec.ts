import { describe, expect, it } from 'vitest';
import { createOpenRefHighlighter } from '../../src/highlight/domain/highlight';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';

/**
 * The real highlighter, with real grammars.
 *
 * Integration rather than unit because loading grammars is the slow part, and because what
 * is being checked is a property of shiki's actual output rather than of our mapping of it:
 * that nothing it produces carries a colour in a style attribute.
 */
describe('createOpenRefHighlighter', () => {
  it('should highlight json with classes and no inline style', async () => {
    // Given
    const highlighter = await createOpenRefHighlighter(['json']);

    // When
    const html = highlighter.highlight('{ "a": 1, "b": [true, null] }', 'json');

    // Then
    expect(html).toContain('class="oref-hl-line"');
    expect(html).toContain('oref-hl-keyword');
    expect(/[\s'"`;{(]style\s*=/.test(html)).toBe(false);
    expect(html).not.toContain('#');
  });

  it('should highlight through a language alias', async () => {
    // Given
    const highlighter = await createOpenRefHighlighter(['javascript']);

    // When
    const html = highlighter.highlight('const a = 1;', 'js');

    // Then
    expect(html).toContain('data-oref-lang="js"');
    expect(html).toContain('oref-hl-');
  });

  it('should fall back to escaped text for a language it did not load', async () => {
    // Given
    const highlighter = await createOpenRefHighlighter(['json']);

    // When
    const html = highlighter.highlight('<b>x</b>', 'brainfuck');

    // Then
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('oref-hl-line');
  });

  it('should escape markup inside highlighted code', async () => {
    // Given
    const highlighter = await createOpenRefHighlighter(['html']);

    // When
    const html = highlighter.highlight('<script>alert(1)</script>', 'html');

    // Then
    // The tokenizer splits the tag, so the escaped text is not one contiguous string. What
    // matters is that no angle bracket survived as markup.
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
  });

  it('should produce the same bytes for the same input twice', async () => {
    // Given
    const highlighter = await createOpenRefHighlighter(['yaml']);
    const source = 'a: 1\nb:\n  - x\n';

    // When
    const results = [highlighter.highlight(source, 'yaml'), highlighter.highlight(source, 'yaml')];

    // Then
    expect(results[0]).toBe(results[1]);
  });

  it('should survive the sanitizer with its classes intact', async () => {
    // Given
    const highlighter = await createOpenRefHighlighter(['json']);
    const markdown = await createMarkdownRenderer({ highlighter });

    // When
    const html = markdown.render('```json\n{ "a": 1 }\n```');

    // Then
    expect(html).toContain('oref-hl-line');
    expect(html).toContain('data-oref-lang="json"');
  });
});
