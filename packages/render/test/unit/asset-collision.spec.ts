import { InvalidOptionsError } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { buildAssetCatalog, digestOf, hashedName } from '../../src/index';

/**
 * The served name of an asset, attacked by `T043`.
 *
 * TWO FAILURES SHARE ONE GUARD. A served name carries sixteen hexadecimal characters of the
 * digest, and `byServedName` was a plain `Map` with no check at all: two assets arriving at one
 * served name would have left the second overwriting the first, both written into the asset
 * directory, and a page linking to the first receiving the second's bytes under a name served
 * `immutable`. Equal served names need a real sixty four bit digest collision and so are not
 * reachable from any input here; folded ones need nothing at all, and that half is measured
 * below.
 */
const encoder = new TextEncoder();

describe('buildAssetCatalog, two assets that arrive at one served name', () => {
  it('should refuse two served names a case folding filesystem stores as one file', () => {
    // Given: the same bytes, so the same digest, under two names that differ only by case. APFS
    // and NTFS answer one entry for both, so the asset directory would hold one of the two.
    const bytes = encoder.encode('.oref-body{color:var(--oref-color-fg)}');
    const sources = [
      { name: 'Theme.css', bytes },
      { name: 'theme.css', bytes },
    ];

    // Then, before the assertion of absence: the two really do reach one name once folded.
    const served = sources.map((source) => hashedName(source.name, digestOf(source.bytes)));
    expect(new Set(served).size).toBe(2);
    expect(new Set(served.map((name) => name.toLowerCase())).size).toBe(1);

    // When
    const attempt = (): unknown => buildAssetCatalog(sources);

    // Then
    expect(attempt).toThrow(InvalidOptionsError);
    expect(attempt).toThrow(/served in place of the other/);
  });

  it('should still refuse two assets offered under one disk name, as it always did', () => {
    // Given
    const sources = [
      { name: 'theme.css', bytes: encoder.encode('a{}') },
      { name: 'theme.css', bytes: encoder.encode('b{}') },
    ];

    // When
    const attempt = (): unknown => buildAssetCatalog(sources);

    // Then
    expect(attempt).toThrow(/offered twice/);
  });

  it('should build an ordinary asset list, so the guard is not a refusal of everything', () => {
    // Given
    const sources = [
      { name: 'theme.css', bytes: encoder.encode('a{}') },
      { name: 'telltale.css', bytes: encoder.encode('b{}') },
      { name: 'openref.js', bytes: encoder.encode('export const hydrate = () => undefined;') },
    ];

    // When
    const catalog = buildAssetCatalog(sources);

    // Then
    expect(catalog.assets).toHaveLength(3);
    expect(catalog.byServedName.size).toBe(3);
  });

  it('should give two assets with identical bytes and different names different served names', () => {
    // Given: identical bytes are not a collision, because the disk name is part of the served one.
    const bytes = encoder.encode('a{}');
    const sources = [
      { name: 'one.css', bytes },
      { name: 'two.css', bytes },
    ];

    // When
    const catalog = buildAssetCatalog(sources);

    // Then
    expect(catalog.byServedName.size).toBe(2);
  });
});
