import { describe, expect, it } from 'vitest';
import { InvalidOptionsError } from '@openref/core';
import {
  CLIENT_BUNDLE_SPECIFIER,
  DEFAULT_THEME_STYLESHEETS,
  loadDefaultAssets,
  resolveAssetPath,
  siblingReferences,
} from '../../src/assets/infrastructure/adapters/package-assets.adapter';

describe('siblingReferences', () => {
  it('should list the files a stylesheet points at, each once and in order', () => {
    // Given
    const css = `
      @font-face{src:url('./A.woff2') format('woff2')}
      @font-face{src:url("./B.woff2")}
      @font-face{src:url(./A.woff2)}
    `;

    // When
    const result = siblingReferences(css);

    // Then
    expect(result).toEqual(['A.woff2', 'B.woff2']);
  });

  it('should ignore everything that is not a file beside it', () => {
    // Given
    const css = `
      a{src:url(https://cdn.test/f.woff2)}
      b{src:url(data:font/woff2;base64,AA)}
      c{src:url(/absolute.woff2)}
      d{src:url(../up.woff2)}
      e{mask:url(#fragment)}
    `;

    // When
    const result = siblingReferences(css);

    // Then
    expect(result).toEqual([]);
  });
});

describe('resolveAssetPath', () => {
  it('should name what it could not find rather than failing with a resolver message', () => {
    // Given
    const specifier = '@openref/not-a-real-package/theme.css';

    // When
    const act = (): string => resolveAssetPath(specifier);

    // Then
    expect(act).toThrow(InvalidOptionsError);
    expect(act).toThrow(/@openref\/not-a-real-package/);
  });
});

describe('loadDefaultAssets', () => {
  it('should refuse a bundle path that is not there rather than serving an empty file', () => {
    // Given
    const clientBundle = '/nowhere/openref.js';

    // When
    const act = (): unknown => loadDefaultAssets({ clientBundle, stylesheets: [] });

    // Then
    expect(act).toThrow(InvalidOptionsError);
    expect(act).toThrow(/nowhere/);
  });

  it('should default to this package bundle and the three files of the default theme', () => {
    // Given, the defaults as data. Loading them needs a build, which the integration suite
    // does; what is checked here is that the defaults are the ones the page needs and in the
    // order the cascade needs them.
    const stylesheets = DEFAULT_THEME_STYLESHEETS;

    // Then
    expect(stylesheets).toEqual([
      '@openref/theme/fonts.css',
      '@openref/theme/tokens.css',
      '@openref/theme/theme.css',
    ]);
    expect(CLIENT_BUNDLE_SPECIFIER).toBe('@openref/nest/browser');
  });
});
