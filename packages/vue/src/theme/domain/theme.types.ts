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
  /** The page shell. Loaded lazily, so an unused theme costs nothing. */
  readonly layout?: () => Promise<unknown>;
  /** Slot overrides, keyed by slot name. Validated against the fixed registry. */
  readonly components?: Readonly<Record<string, Component>>;
  readonly tokens?: ThemeTokens;
  readonly assets?: ThemeAssets;
}

/** A theme after validation, as the state holds it. */
export interface ResolvedTheme {
  readonly name: string;
  readonly layout?: () => Promise<unknown>;
  readonly slots: SlotRegistry;
  readonly tokens: ThemeTokens;
  readonly assets: ThemeAssets;
}
