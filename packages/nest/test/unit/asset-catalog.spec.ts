import { describe, expect, it } from 'vitest';
import { InvalidOptionsError } from '@openref/core';
import {
  buildAssetCatalog,
  contentTypeFor,
  DIGEST_LENGTH,
  digestOf,
  hashedName,
  rewriteCssUrls,
} from '../../src/assets/domain/asset-catalog';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Bytes for a fixture.
 *
 * @param text - Contents
 * @returns The bytes
 */
function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

describe('contentTypeFor', () => {
  it('should name a type for every kind of file this package serves', () => {
    // Given
    const names = ['a.css', 'a.js', 'a.json', 'a.svg', 'a.woff2'];

    // When
    const results = names.map((name) => contentTypeFor(name));

    // Then
    expect(results).toEqual([
      'text/css; charset=utf-8',
      'text/javascript; charset=utf-8',
      'application/json; charset=utf-8',
      'image/svg+xml',
      'font/woff2',
    ]);
  });

  it('should refuse an extension nobody declared rather than serving it as bytes', () => {
    // Given
    const name = 'secrets.env';

    // When
    const act = (): string => contentTypeFor(name);

    // Then
    expect(act).toThrow(InvalidOptionsError);
  });
});

describe('hashedName', () => {
  it('should put the digest before the extension so the extension still ends the name', () => {
    // Given
    const name = 'theme.css';

    // When
    const result = hashedName(name, 'abc123');

    // Then
    expect(result).toBe('theme.abc123.css');
  });

  it('should append the digest when the name has no extension', () => {
    // Given
    const name = 'LICENSE';

    // When
    const result = hashedName(name, 'abc123');

    // Then
    expect(result).toBe('LICENSE.abc123');
  });
});

describe('digestOf', () => {
  it('should differ for one changed byte, which is the whole basis of immutable caching', () => {
    // Given
    const first = bytes('a');
    const second = bytes('b');

    // When
    const digests = [digestOf(first), digestOf(second)];

    // Then
    expect(digests[0]).not.toBe(digests[1]);
    expect(digests[0]).toHaveLength(DIGEST_LENGTH);
  });
});

describe('rewriteCssUrls', () => {
  it('should rename a sibling reference to the name it is served under', () => {
    // Given
    const css = "@font-face{src:url('./Face.woff2') format('woff2')}";

    // When
    const result = rewriteCssUrls(css, (name) =>
      name === 'Face.woff2' ? 'Face.dead.woff2' : undefined,
    );

    // Then
    expect(result).toBe("@font-face{src:url('./Face.dead.woff2') format('woff2')}");
  });

  it('should keep the quoting it found, including none at all', () => {
    // Given
    const css = 'a{background:url(pic.svg)}b{background:url("./pic.svg")}';

    // When
    const result = rewriteCssUrls(css, () => 'pic.dead.svg');

    // Then
    expect(result).toBe('a{background:url(./pic.dead.svg)}b{background:url("./pic.dead.svg")}');
  });

  it('should leave alone anything this catalog does not serve', () => {
    // Given
    const css = 'a{src:url(https://cdn.test/f.woff2)}b{src:url(data:font/woff2;base64,AA)}';

    // When
    const result = rewriteCssUrls(css, () => 'never.used');

    // Then
    expect(result).toBe(css);
  });

  it('should refuse a sibling reference the catalog does not hold', () => {
    // Given
    const css = "@font-face{src:url('./Missing.woff2')}";

    // When
    const act = (): string => rewriteCssUrls(css, () => undefined);

    // Then
    expect(act).toThrow(InvalidOptionsError);
  });
});

describe('buildAssetCatalog', () => {
  it('should hash a stylesheet after rewriting it, so its digest covers what it points at', () => {
    // Given
    const font = bytes('font one');
    const css = "@font-face{src:url('./Face.woff2')}";

    // When
    const first = buildAssetCatalog([
      { name: 'Face.woff2', bytes: font },
      { name: 'theme.css', bytes: bytes(css) },
    ]);
    const second = buildAssetCatalog([
      { name: 'Face.woff2', bytes: bytes('font two') },
      { name: 'theme.css', bytes: bytes(css) },
    ]);

    // Then
    // The stylesheet source is byte identical in both. Its served name still differs, because
    // the name it refers to changed, which is what makes a year of immutable caching safe.
    const firstCss = first.byName.get('theme.css');
    const secondCss = second.byName.get('theme.css');
    expect(firstCss?.servedName).not.toBe(secondCss?.servedName);
  });

  it('should serve the rewritten stylesheet, not the one that was handed over', () => {
    // Given
    const sources = [
      { name: 'Face.woff2', bytes: bytes('font') },
      { name: 'theme.css', bytes: bytes("@font-face{src:url('./Face.woff2')}") },
    ];

    // When
    const catalog = buildAssetCatalog(sources);
    const served = catalog.byName.get('theme.css');
    const fontName = catalog.byName.get('Face.woff2')?.servedName ?? '';

    // Then
    expect(decoder.decode(served?.bytes)).toBe(`@font-face{src:url('./${fontName}')}`);
  });

  it('should address every asset by both names', () => {
    // Given
    const sources = [{ name: 'openref.js', bytes: bytes('x') }];

    // When
    const catalog = buildAssetCatalog(sources);
    const asset = catalog.byName.get('openref.js');

    // Then
    expect(catalog.byServedName.get(asset?.servedName ?? '')).toBe(asset);
  });

  it('should refuse the same name twice, since one copy would be unreachable', () => {
    // Given
    const sources = [
      { name: 'openref.js', bytes: bytes('one') },
      { name: 'openref.js', bytes: bytes('two') },
    ];

    // When
    const act = (): unknown => buildAssetCatalog(sources);

    // Then
    expect(act).toThrow(InvalidOptionsError);
  });

  it('should be deterministic, so two builds of one input serve one set of names', () => {
    // Given
    const sources = [
      { name: 'Face.woff2', bytes: bytes('font') },
      { name: 'theme.css', bytes: bytes("@font-face{src:url('./Face.woff2')}") },
    ];

    // When
    const names = [buildAssetCatalog(sources), buildAssetCatalog(sources)].map((catalog) =>
      catalog.assets.map((asset) => asset.servedName),
    );

    // Then
    expect(names[0]).toEqual(names[1]);
  });
});
