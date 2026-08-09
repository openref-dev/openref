import { describe, expect, it } from 'vitest';
import {
  AA_LARGE_CONTRAST,
  AA_TEXT_CONTRAST,
  CONTRAST_PAIRS,
  contrastRatio,
  DARK_TOKEN_VALUES,
  hexContrastRatio,
  LIGHT_TOKEN_VALUES,
  parseHexColor,
  relativeLuminance,
} from '../../src/index';

/**
 * Contrast is asserted, not eyeballed, per BUILD T009.
 *
 * The pairs come from `CONTRAST_PAIRS`, which lists what the stylesheet actually draws on
 * what. A pair with the `decorative` role claims nothing and is checked for nothing, which is
 * honest: a separator line is not a control boundary, and pretending it is would either fail
 * the build for no reason or push the border towards a colour it should not be.
 */

const REQUIRED = { text: AA_TEXT_CONTRAST, large: AA_LARGE_CONTRAST, decorative: 0 } as const;

function valueOf(name: string, scheme: 'light' | 'dark'): string {
  const values = scheme === 'light' ? LIGHT_TOKEN_VALUES : DARK_TOKEN_VALUES;
  const value = values[name];
  if (value === undefined) throw new Error(`no token named ${name}`);
  return value;
}

describe('colour arithmetic', () => {
  it('should parse a six digit hexadecimal colour', () => {
    // Given
    const value = '#0d1117';

    // When
    const parsed = parseHexColor(value);

    // Then
    expect(parsed).toEqual({ r: 13, g: 17, b: 23 });
  });

  it('should expand a three digit hexadecimal colour', () => {
    // Given
    const value = '#fff';

    // When
    const parsed = parseHexColor(value);

    // Then
    expect(parsed).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('should refuse anything that is not a hexadecimal colour', () => {
    // Given
    const values = ['rgb(0,0,0)', '#12345', 'white', '', '#'];

    // When
    const parsed = values.map((value) => parseHexColor(value));

    // Then
    expect(parsed).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it('should give black and white the ratio WCAG defines', () => {
    // Given
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };

    // When
    const ratio = contrastRatio(black, white);

    // Then
    expect(ratio).toBeCloseTo(21, 5);
  });

  it('should give a colour against itself a ratio of one', () => {
    // Given
    const color = { r: 11, g: 95, b: 208 };

    // When
    const ratio = contrastRatio(color, color);

    // Then
    expect(ratio).toBeCloseTo(1, 10);
  });

  it('should be symmetric, since contrast has no direction', () => {
    // Given
    const front = '#1b1f24';
    const back = '#f6f7f9';

    // When
    const forward = hexContrastRatio(front, back);

    // Then
    expect(forward).toBeCloseTo(hexContrastRatio(back, front), 10);
  });

  it('should put black at luminance zero and white at one', () => {
    // Given
    const black = { r: 0, g: 0, b: 0 };

    // When
    const white = { r: 255, g: 255, b: 255 };

    // Then
    expect(relativeLuminance(black)).toBeCloseTo(0, 10);
    expect(relativeLuminance(white)).toBeCloseTo(1, 10);
  });

  it('should refuse to compare something that is not a colour', () => {
    // Given
    const compare = (): number => hexContrastRatio('#000000', 'not-a-colour');

    // When, the theme's own values are hexadecimal, so this only fires on a mistake.

    // Then
    expect(compare).toThrow(RangeError);
  });
});

describe('default theme contrast', () => {
  it('should name only tokens that exist', () => {
    // Given
    const names = CONTRAST_PAIRS.flatMap((pair) => [pair.foreground, pair.background]);

    // When
    const missing = names.filter((name) => LIGHT_TOKEN_VALUES[name] === undefined);

    // Then
    expect(missing).toEqual([]);
  });

  it('should cover both colour schemes', () => {
    // Given
    const schemes = new Set(CONTRAST_PAIRS.map((pair) => pair.scheme));

    // When
    const covered = [...schemes].sort((a, b) => a.localeCompare(b));

    // Then
    expect(covered).toEqual(['dark', 'light']);
  });

  for (const pair of CONTRAST_PAIRS) {
    if (pair.role === 'decorative') continue;

    it(`should meet WCAG AA for ${pair.foreground} on ${pair.background} in ${pair.scheme}`, () => {
      // Given
      const foreground = valueOf(pair.foreground, pair.scheme);
      const background = valueOf(pair.background, pair.scheme);

      // When
      const ratio = hexContrastRatio(foreground, background);

      // Then
      expect(ratio).toBeGreaterThanOrEqual(REQUIRED[pair.role]);
    });
  }

  it('should claim nothing for a decorative pair', () => {
    // Given, the separator is not a control boundary and does not pretend to be one.
    const decorative = CONTRAST_PAIRS.filter((pair) => pair.role === 'decorative');

    // When
    const required = decorative.map((pair) => REQUIRED[pair.role]);

    // Then
    expect(decorative.length).toBeGreaterThan(0);
    expect(required.every((value) => value === 0)).toBe(true);
  });
});
