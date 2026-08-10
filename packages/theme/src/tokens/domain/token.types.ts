/**
 * The token model, per SPEC 10.1 and STANDARDS 4.4.
 *
 * L0 theming is the whole of this file's reason to exist: a consumer restyles the reference by
 * setting custom properties and writing no code at all. Every visible value in the default
 * theme traces to one of these, which is what "the core ships no visual opinion" means in
 * practice.
 */

/**
 * Groups a token can belong to. The group is the first segment of `--oref-{group}-{name}`.
 *
 * These are the thirteen groups of `ai-docs/design/CONTRACT.md` and nothing else. A group is not
 * a label on a list: `prov`, `state` and `drift` exist because provenance, response class and
 * drift severity are three different things that all happen to be coloured, and collapsing
 * them into `color` is what makes a theme paint a warning and a derived fact the same amber
 * without noticing.
 *
 * `motion` is a group for the same kind of reason, and the reason is written down in the
 * contract: with durations as tokens a theme collapses motion by pointing them at the zero
 * token and a checker can read whether it did. Without them, every theme writes its own
 * reduced motion block and nothing can tell whether a theme wrote one.
 *
 * MOTION IS ONE GROUP AND NOT TWO, decided on 2026-08-10 when the designer's names arrived as
 * `duration-*` and `easing-*`. They live under `motion-` rather than becoming groups of their
 * own: `--oref-duration-none` says nothing on its own, while `--oref-motion-duration-none`
 * reads as "no motion", which is what it means and what a theme author sees at the call site.
 * The group will also grow, with a delay and with separate durations for entry against exit,
 * and those are motion rather than time in the abstract. Two groups that always change
 * together are one group.
 */
export type TokenGroup =
  | 'color'
  | 'font'
  | 'space'
  | 'radius'
  | 'border'
  | 'shadow'
  | 'focus'
  | 'layout'
  | 'prov'
  | 'state'
  | 'drift'
  | 'motion'
  | 'scrim';

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
