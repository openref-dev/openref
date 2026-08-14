import type { Component } from 'vue';
import type { SlotRegistry } from '../../slots/domain/slot-registry';

/**
 * The theme contract, per SPEC 10.4.
 *
 * A theme is data, not code that runs at import time: a name, a layout, slot overrides,
 * token defaults and stylesheet paths. That is what lets the same definition be read by the
 * server renderer, by the static build and by the browser without any of them executing it.
 */

/**
 * Design token defaults a theme ships.
 *
 * Keys are CSS custom properties in the `--oref-{group}-{name}` form of STANDARDS 11. Values
 * are plain CSS, never computed, because a token that has to be computed ends up in an inline
 * style, and an inline style cannot be authorized by a CSP nonce.
 */
export type ThemeTokens = Readonly<Record<string, string>>;

/** Stylesheets a theme brings with it. */
export interface ThemeAssets {
  readonly css?: readonly string[];
}

/** A theme as its author writes it. */
export interface ThemeDefinition {
  readonly name: string;
  /**
   * The page shell, loaded lazily, so an unused theme costs nothing.
   *
   * IT IS THE `AppShell` SLOT UNDER ANOTHER NAME AND IT RESOLVES INTO IT. This is the authoring
   * surface, because `layout: () => import('./Layout.vue')` reads better than a component in a
   * map, and `resolveTheme` wraps it into the slot rather than keeping a second path beside it.
   * A theme that declares both this and `components.AppShell` is refused: two mechanisms for one
   * position is the defect `TX-SLOTWIRE` was filed about, in miniature.
   */
  readonly layout?: () => Promise<unknown>;
  /** Slot overrides, keyed by slot name. Validated against the fixed registry. */
  readonly components?: Readonly<Record<string, Component>>;
  readonly tokens?: ThemeTokens;
  readonly assets?: ThemeAssets;
}

/**
 * A theme after validation, as the state holds it.
 *
 * THERE IS NO `layout` HERE, and that is the resolution rather than an omission: it is in
 * `slots` as `AppShell`, so one position has one lookup and a renderer that resolves slots
 * resolves the layout by doing nothing extra.
 */
export interface ResolvedTheme {
  readonly name: string;
  readonly slots: SlotRegistry;
  readonly tokens: ThemeTokens;
  readonly assets: ThemeAssets;
}
