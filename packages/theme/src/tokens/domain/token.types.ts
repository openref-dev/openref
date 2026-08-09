/**
 * The token model, per SPEC 10.1 and STANDARDS 4.4.
 *
 * L0 theming is the whole of this file's reason to exist: a consumer restyles the reference by
 * setting custom properties and writing no code at all. Every visible value in the default
 * theme traces to one of these, which is what "the core ships no visual opinion" means in
 * practice.
 */

/** Groups a token can belong to. The group is the first segment of `--oref-{group}-{name}`. */
export type TokenGroup = 'color' | 'space' | 'font' | 'radius' | 'elevation' | 'motion' | 'layout';

/** One design token. */
export interface ThemeToken {
  /** Full custom property name, `--oref-{group}-{name}`. */
  readonly name: string;
  readonly group: TokenGroup;
  /** Value in the default, light colour scheme. */
  readonly value: string;
  /** Value when the dark colour scheme is in force, absent when the token does not change. */
  readonly dark?: string;
  /** What the token is for, so a theme author can override it without guessing. */
  readonly description: string;
}

/** How a pair of colour tokens is used, which decides the contrast it must reach. */
export type ContrastRole =
  /** Body text. WCAG 2.2 AA requires 4.5. */
  | 'text'
  /** Large text, an icon, or the boundary of a control. AA requires 3. */
  | 'large'
  /** Decoration with no meaning of its own. AA requires nothing, and nothing is claimed. */
  | 'decorative';

/** A foreground and background pair the theme actually puts together. */
export interface ContrastPair {
  readonly foreground: string;
  readonly background: string;
  readonly role: ContrastRole;
  readonly scheme: 'light' | 'dark';
}
