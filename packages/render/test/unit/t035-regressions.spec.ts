/**
 * The regression suite of T035's findings in `@openref/render`.
 *
 * Each case names the finding it holds shut and the reason the shipped behaviour was wrong, because
 * a regression test whose subject is only visible in a diff is a test nobody can re-derive.
 */

import { describe, expect, it } from 'vitest';
import { InvalidOptionsError } from '@openref/core';
import { renderHtmlDocument } from '../../src/page/domain/shell';
import {
  branchFieldPaths,
  keptCount,
  patternVerdict,
  typeError,
  unusablePatternWords,
} from '../../src/page/domain/shape-form';
import type { RenderedPage } from '../../src/index';

/** The smallest rendered page the shell will assemble, so the token block is what varies. */
function pageWith(tokens: Readonly<Record<string, string>>): () => string {
  const page: RenderedPage = {
    documentHash: 'h',
    nodeId: null,
    schemaId: null,
    title: 'T',
    appHtml: '<div></div>',
    stateJson: '{}',
  };

  // A REAL NONCE. The first draft of this file used `n1`, and `assertNonce` refused it before the
  // token guard was ever reached, so the refusal case passed while proving the wrong refusal.
  return () =>
    renderHtmlDocument(page, {
      tokens,
      nonce: 'c2Vzc2lvbjYyVDAzNQ==',
      assets: { stylesheets: [], modules: [] },
    });
}

describe('a theme token value on its way into the style element', () => {
  it('should refuse a semicolon, which opens a declaration nobody authorized', () => {
    // Given a token value that ends its own declaration and begins two more
    const render = pageWith({ '--oref-color-fg': 'red;position:fixed;top:0' });

    // Then it is refused rather than escaped, per the guard's own stance. It could never escape
    // `:root{...}`, which is why `;` was let through until T035; what it does instead is write
    // declarations onto the root element from inside the one style element the strict CSP of
    // SPEC 19.2 authorizes with a nonce.
    expect(render).toThrow(InvalidOptionsError);
    expect(render).toThrow(/cannot be written into a style element/);
  });

  it('should still write an ordinary value, so the refusal is about structure and not about CSS', () => {
    // Given a font stack, which separates with commas and is the value most likely to look risky
    const html = pageWith({ '--oref-font-sans': 'Inter, system-ui, sans-serif' })();

    // Then it is written whole
    expect(html).toContain('--oref-font-sans:Inter, system-ui, sans-serif');
  });
});

describe('a pattern the document supplied', () => {
  it('should call an invalid pattern unusable rather than throwing out of the render', () => {
    // Given a pattern that is not a regular expression
    // Then nothing throws, and the answer is about the document rather than about the value.
    // Until T035 this was `new RegExp('(')` on the render thread: a `SyntaxError` inside a Vue
    // render, with no error boundary in any package to catch it.
    expect(() => patternVerdict('(', 'anything')).not.toThrow();
    expect(patternVerdict('(', 'anything')).toBe('unusable');
    expect(typeError('anything', { type: 'string', pattern: '(' })).toBe(unusablePatternWords('('));
  });

  it('should refuse a nested quantifier instead of running it on the main thread', () => {
    // Given the shape that backtracks catastrophically
    // Then it is refused by the guard `@openref/core` already exported for the sampler
    expect(patternVerdict('^(a+)+$', 'a'.repeat(40))).toBe('unusable');
  });

  it('should still judge an ordinary pattern both ways', () => {
    // Given a pattern a real document writes
    expect(patternVerdict('^\\d{5}$', '12345')).toBe('matches');
    expect(patternVerdict('^\\d{5}$', 'abcde')).toBe('differs');
    expect(typeError('12345', { type: 'string', pattern: '^\\d{5}$' })).toBeUndefined();
  });
});

describe('the sentence a branch switch says about what it kept', () => {
  it('should count values under a member the branch owns but no control writes', () => {
    // Given a branch whose member carries variants rather than properties, which is what
    // `branchFieldPaths` pushes a container path for
    const paths = branchFieldPaths(
      {
        properties: {
          method: { type: 'string' },
          terms: { oneOf: [{ type: 'object' }] },
        },
      },
      'method',
      '',
    );

    // And values the reader typed three levels down inside it
    const values = {
      '/terms/kind': 'milestone',
      '/terms/schedule/basis': 'dates',
      '/terms/schedule/dates': '2026-01-01',
    };

    // Then the count is three. It was zero until T035: `ownedPaths` holds `/terms`, no control
    // ever writes that exact path, and the status line announced `Values kept from the hidden
    // branch: 0` while the map held all three. The sentence is SPEC 11's recorded wording, and it
    // was telling the reader the opposite of what the engine did.
    expect(paths).toContain('/terms');
    expect(keptCount(paths, values)).toBe(3);
  });

  it('should not count a sibling path that merely starts with the same characters', () => {
    // Given a branch owning `/terms` and a value under `/termsAndConditions`
    const values = { '/termsAndConditions': 'yes' };

    // Then the prefix match is on a path segment rather than on characters
    expect(keptCount(['/terms'], values)).toBe(0);
  });

  it('should not count an empty value, which is a field the reader cleared', () => {
    expect(keptCount(['/pan'], { '/pan': '' })).toBe(0);
    expect(keptCount(['/pan'], { '/pan': '4111' })).toBe(1);
  });
});
