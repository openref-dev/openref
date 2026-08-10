/**
 * Values that exist only because a slot carries them.
 *
 * Each of these is part of the frozen slot contract, so it lives beside the contract rather
 * than in whichever feature will eventually produce it. A type declared next to its producer
 * would be unavailable until that producer is built, and the props would have to change shape
 * when it arrives, which is the one thing a frozen contract must not do.
 */

/**
 * One rendered call sample, per SPEC 18.
 *
 * The generator arrives in M6 and `x-codeSamples` is read from the specification before that.
 * Both produce this shape, which is also the shape the extension writes, so a sample from the
 * document and a sample from the generator are indistinguishable to a theme.
 */
export interface CodeSampleView {
  /** Language identifier, as a highlighter understands it, for example `bash` or `python`. */
  readonly lang: string;
  /** What the tab says, for example `cURL`. */
  readonly label: string;
  readonly source: string;
}

/**
 * Why a region is showing a notice instead of content.
 *
 * The five the design names, plus `unavailable` for a feature this build does not carry. That
 * last one is not a synonym for `no-runtime`: a build with no runner is a build decision, while
 * no runtime facts means no collector ran against a build that has them.
 */
export type StateNoticeKind =
  | 'empty'
  | 'no-runtime'
  | 'stale-cache'
  | 'no-results'
  | 'no-descriptions'
  | 'unavailable';

/**
 * What a reader has asked for, which is not the same as what they get.
 *
 * `system` means no choice was made and the operating system decides, which is the default the
 * theme implements with `prefers-color-scheme`. The two explicit values write
 * `data-oref-color-scheme` and override it.
 */
export type ColorSchemePreference = 'system' | 'light' | 'dark';

/** The scheme actually being painted, once the preference and the system have been resolved. */
export type ColorScheme = 'light' | 'dark';
