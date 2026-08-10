import { describe, expect, it } from 'vitest';
import { scanClientBundle, SERVER_ONLY_MARKERS } from '../mocks/bundle-scan';

/**
 * The scanner that guards the client bundle, checked against planted content.
 *
 * Without this, "no server library in the bundle" would pass just as happily if the scan
 * matched nothing at all.
 */
describe('scanClientBundle', () => {
  it('should find each server only marker when it is planted', () => {
    // Given
    const bundles = SERVER_ONLY_MARKERS.map((marker) => `const x = "${marker}";`);

    // When
    const results = bundles.map((bundle) => scanClientBundle(bundle).forbidden.length);

    // Then
    expect(results.every((count) => count > 0)).toBe(true);
  });

  it('should find a planted inline style attribute', () => {
    // Given
    const bundle = 'el.innerHTML = \'<div style="color:red">x</div>\';';

    // When
    const result = scanClientBundle(bundle);

    // Then
    expect(result.cspViolations).toContain('inline-style-attribute');
  });

  it('should find a planted dynamic evaluation', () => {
    // Given
    const bundles = ['const f = new Function("return 1");', 'eval("1 + 1");'];

    // When
    const results = bundles.map((bundle) => scanClientBundle(bundle).cspViolations);

    // Then
    expect(results.every((violations) => violations.includes('dynamic-code-evaluation'))).toBe(
      true,
    );
  });

  it('should stay silent on a bundle with none of the plants', () => {
    // Given
    const bundle = 'export function hydrate(){ return document.getElementById("oref-app"); }';

    // When
    const result = scanClientBundle(bundle);

    // Then
    expect(result).toEqual({ forbidden: [], cspViolations: [] });
  });
});
