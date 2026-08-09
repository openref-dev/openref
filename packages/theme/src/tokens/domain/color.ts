/**
 * sRGB colour arithmetic, enough to assert contrast rather than eyeball it.
 *
 * WCAG 2.2 defines contrast over relative luminance, and relative luminance over linearized
 * sRGB channels. Both formulae are here in full, because a theme that claims AA and does not
 * meet it is worse than one that claims nothing.
 */

/** A colour with channels in 0 to 255. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Contrast a body of text must reach to meet WCAG 2.2 AA. */
export const AA_TEXT_CONTRAST = 4.5;

/** Contrast large text, an icon or a control boundary must reach to meet WCAG 2.2 AA. */
export const AA_LARGE_CONTRAST = 3;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Parses a hexadecimal colour.
 *
 * @param value - A colour such as `#0d1117` or `#fff`
 * @returns The channels, or `undefined` when the value is not a hexadecimal colour
 *
 * @example
 * parseHexColor('#0d1117');
 */
export function parseHexColor(value: string): Rgb | undefined {
  if (!HEX.test(value)) return undefined;

  const digits = value.slice(1);
  const expanded =
    digits.length === 3 ? digits.replace(/[0-9a-fA-F]/g, (digit) => `${digit}${digit}`) : digits;

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function linearize(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

/**
 * Relative luminance, per WCAG 2.2.
 *
 * @param color - The colour
 * @returns Luminance from 0 for black to 1 for white
 */
export function relativeLuminance(color: Rgb): number {
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}

/**
 * Contrast ratio between two colours, per WCAG 2.2.
 *
 * @param foreground - The colour drawn on top
 * @param background - The colour behind it
 * @returns A ratio from 1 to 21
 *
 * @example
 * contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
 */
export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Contrast ratio between two hexadecimal colours.
 *
 * @param foreground - The colour drawn on top
 * @param background - The colour behind it
 * @returns The ratio
 * @throws {RangeError} When either value is not a hexadecimal colour
 */
export function hexContrastRatio(foreground: string, background: string): number {
  const front = parseHexColor(foreground);
  const back = parseHexColor(background);
  if (front === undefined || back === undefined) {
    throw new RangeError(
      `not a hexadecimal colour: ${front === undefined ? foreground : background}`,
    );
  }
  return contrastRatio(front, back);
}
