import { describe, expect, it } from 'vitest';
import {
  codeBlockHtml,
  fontStyleClasses,
  HIGHLIGHT_CLASS_PREFIX,
  isBundledLanguage,
  plainHighlighter,
  tokenClass,
} from '../../src/highlight/domain/highlight';

describe('tokenClass', () => {
  it('should map a token variable to a class', () => {
    // Given
    const color = 'var(--oref-hl-token-keyword)';

    // When
    const result = tokenClass(color);

    // Then
    expect(result).toBe('oref-hl-keyword');
  });

  it('should map a variable that is not a token to a class of the same name', () => {
    // Given
    const color = 'var(--oref-hl-string)';

    // When
    const result = tokenClass(color);

    // Then
    expect(result).toBe('oref-hl-string');
  });

  it('should give the default colour no class of its own', () => {
    // Given
    const colors = ['var(--oref-hl-foreground)', 'var(--oref-hl-background)'];

    // When
    const results = colors.map((color) => tokenClass(color));

    // Then
    expect(results).toEqual([null, null]);
  });

  it('should refuse a literal colour rather than turning it into an inline style', () => {
    // Given
    const colors = ['#ff0000', 'rgb(1,2,3)', 'var(--other-theme-token)', undefined];

    // When
    const results = colors.map((color) => tokenClass(color));

    // Then
    expect(results).toEqual([null, null, null, null]);
  });
});

describe('fontStyleClasses', () => {
  it('should map the bitmask to classes in a fixed order', () => {
    // Given
    const mask = 1 | 2 | 4;

    // When
    const result = fontStyleClasses(mask);

    // Then
    expect(result).toEqual([
      `${HIGHLIGHT_CLASS_PREFIX}italic`,
      `${HIGHLIGHT_CLASS_PREFIX}bold`,
      `${HIGHLIGHT_CLASS_PREFIX}underline`,
    ]);
  });

  it('should produce nothing for an absent or empty style', () => {
    // Given
    const masks = [undefined, 0, -1];

    // When
    const results = masks.map((mask) => fontStyleClasses(mask));

    // Then
    expect(results).toEqual([[], [], []]);
  });
});

describe('plainHighlighter', () => {
  it('should escape markup in code rather than emitting it', () => {
    // Given
    const code = '<script>alert("x")</script>';

    // When
    const result = plainHighlighter.highlight(code, undefined);

    // Then
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('should escape the language name it writes into an attribute', () => {
    // Given
    const language = 'json" onload="x';

    // When
    const result = plainHighlighter.highlight('{}', language);

    // Then
    expect(result).not.toContain('onload="x"');
    expect(result).toContain('&quot;');
  });
});

describe('codeBlockHtml', () => {
  it('should omit the language attribute when there is no language', () => {
    // Given
    const body = 'x';

    // When
    const result = codeBlockHtml(body, undefined);

    // Then
    expect(result).toBe('<pre class="oref-code"><code>x</code></pre>');
  });
});

describe('isBundledLanguage', () => {
  it('should recognise a language and its alias', () => {
    // Given
    const names = ['json', 'yaml', 'js'];

    // When
    const results = names.map((name) => isBundledLanguage(name));

    // Then
    expect(results).toEqual([true, true, true]);
  });

  it('should refuse a name that is not bundled, including one from a document', () => {
    // Given
    const names = ['not-a-language', 'constructor', '__proto__'];

    // When
    const results = names.map((name) => isBundledLanguage(name));

    // Then
    expect(results).toEqual([false, false, false]);
  });
});
