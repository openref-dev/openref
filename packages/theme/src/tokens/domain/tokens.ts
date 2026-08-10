import type { ContrastPair, ThemeToken } from './token.types';

/**
 * The core token set: the 109 names of `ai-docs/design/CONTRACT.md`, with the values of the
 * vernier design, which is what `@openref/theme` ships.
 *
 * The names are the contract and are identical in every theme. The values are this theme's.
 * A theme that renames one, omits one, or defines one in a single colour scheme is not a
 * conforming theme, which is what the conformance checker in T031 will assert.
 *
 * This file and `styles/tokens.css` are the only places in the package where a literal colour,
 * length or font stack may appear. Everywhere else reads `var(--oref-*)`, and a gate fails the
 * build on a literal that escapes. `tokens.css` is generated from these arrays and pinned by a
 * test, so the two cannot drift.
 */
export const THEME_TOKENS: readonly ThemeToken[] = [
  // Colour. Two accent axes, per the contract: what the specification asserts and what
  // the running application shows. A theme that does not separate them by colour sets both to
  // one value and carries the separation through position instead.
  {
    name: '--oref-color-bg',
    group: 'color',
    value: '#eef1f4',
    dark: '#080b0f',
    description: 'Page background',
  },
  {
    name: '--oref-color-bg-sunken',
    group: 'color',
    value: '#e6eaee',
    dark: '#0b1015',
    description: 'Behind the page: under a rail, a gutter or a sticky bar',
  },
  {
    name: '--oref-color-surface',
    group: 'color',
    value: '#ffffff',
    dark: '#0f151b',
    description: 'Raised surface: panel, card, dialog',
  },
  {
    name: '--oref-color-surface-inset',
    group: 'color',
    value: '#f6f8fa',
    dark: '#131b22',
    description: 'Recessed surface: rail, table header, inset panel',
  },
  {
    name: '--oref-color-surface-code',
    group: 'color',
    value: '#f2f5f7',
    dark: '#060a0d',
    description: 'Background of a code block',
  },
  {
    name: '--oref-color-fg',
    group: 'color',
    value: '#08111a',
    dark: '#e8eef4',
    description: 'Body text',
  },
  {
    name: '--oref-color-fg-secondary',
    group: 'color',
    value: '#465768',
    dark: '#93a4b3',
    description: 'Descriptions and metadata',
  },
  {
    name: '--oref-color-fg-muted',
    group: 'color',
    value: '#5f6e7a',
    dark: '#79899a',
    description: 'Micro labels at the smallest size step',
  },
  {
    name: '--oref-color-fg-inverse',
    group: 'color',
    value: '#ffffff',
    dark: '#060a0d',
    description: 'Text drawn on an accent or a method colour',
  },
  {
    name: '--oref-color-line',
    group: 'color',
    value: '#d9dfe5',
    dark: '#161f28',
    description: 'Separator, decorative, no contrast claim',
  },
  {
    name: '--oref-color-line-edge',
    group: 'color',
    value: '#bfc9d2',
    dark: '#22303c',
    description: 'Edge of a panel, a gutter or a ruler',
  },
  {
    name: '--oref-color-line-strong',
    group: 'color',
    value: '#93a2ae',
    dark: '#384b5c',
    description: 'Boundary of a control, which must stay distinguishable',
  },
  {
    name: '--oref-color-accent-spec',
    group: 'color',
    value: '#1f57ab',
    dark: '#8fbcff',
    description: 'Everything the specification asserts, and the primary button',
  },
  {
    name: '--oref-color-accent-runtime',
    group: 'color',
    value: '#8a5200',
    dark: '#ffb020',
    description: 'Everything observed in the running application',
  },
  {
    name: '--oref-color-accent-link',
    group: 'color',
    value: '#1f57ab',
    dark: '#8fbcff',
    description: 'Links, which may differ from both accent layers',
  },
  {
    name: '--oref-color-accent-bg',
    group: 'color',
    value: '#eaf1fc',
    dark: '#0e1a2a',
    description: 'Calm background of an active or selected element',
  },
  {
    name: '--oref-color-accent-soft',
    group: 'color',
    value: '#cfe0f7',
    dark: '#17293c',
    description: 'Stronger background for a pressed state and for text selection',
  },
  {
    name: '--oref-color-method-get',
    group: 'color',
    value: '#1f57ab',
    dark: '#8fbcff',
    description: 'GET badge',
  },
  {
    name: '--oref-color-method-post',
    group: 'color',
    value: '#0b6b45',
    dark: '#3fd18b',
    description: 'POST badge',
  },
  {
    name: '--oref-color-method-put',
    group: 'color',
    value: '#8a5200',
    dark: '#ffb020',
    description: 'PUT badge',
  },
  {
    name: '--oref-color-method-patch',
    group: 'color',
    value: '#5b3ba8',
    dark: '#b98cff',
    description: 'PATCH badge',
  },
  {
    name: '--oref-color-method-delete',
    group: 'color',
    value: '#a92616',
    dark: '#ff5a47',
    description: 'DELETE badge',
  },
  {
    name: '--oref-color-method-sse',
    group: 'color',
    value: '#00666b',
    dark: '#38d6d6',
    description: 'Server sent events badge',
  },
  {
    name: '--oref-color-method-event',
    group: 'color',
    value: '#465768',
    dark: '#93a4b3',
    description: 'Event channel badge',
  },
  {
    name: '--oref-color-scrim',
    group: 'color',
    value: 'rgba(8, 17, 26, 0.46)',
    dark: 'rgba(4, 7, 10, 0.66)',
    description: 'The surface behind a modal, which a dialog is read against',
  },

  // Typography. Two self hosted families and a display family, nine size steps, three
  // leadings and three trackings.
  {
    name: '--oref-font-family-sans',
    group: 'font',
    value: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
    description: 'Interface text and prose',
  },
  {
    name: '--oref-font-family-mono',
    group: 'font',
    value: "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace",
    description: 'Paths, types, numbers, code and samples',
  },
  {
    name: '--oref-font-family-display',
    group: 'font',
    value: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
    description: 'Headings and hero numerals',
  },
  {
    name: '--oref-font-weight-regular',
    group: 'font',
    value: '400',
    description: 'Body',
  },
  {
    name: '--oref-font-weight-medium',
    group: 'font',
    value: '500',
    description: 'Emphasis',
  },
  {
    name: '--oref-font-weight-bold',
    group: 'font',
    value: '700',
    description: 'Headings',
  },
  {
    name: '--oref-font-size-100',
    group: 'font',
    value: '11px',
    description: '11 px, micro label',
  },
  {
    name: '--oref-font-size-200',
    group: 'font',
    value: '12px',
    description: '12 px, small label',
  },
  {
    name: '--oref-font-size-300',
    group: 'font',
    value: '13px',
    description: '13 px, dense table text',
  },
  {
    name: '--oref-font-size-400',
    group: 'font',
    value: '14px',
    description: '14 px, secondary text',
  },
  {
    name: '--oref-font-size-500',
    group: 'font',
    value: '16px',
    description: '16 px, body',
  },
  {
    name: '--oref-font-size-600',
    group: 'font',
    value: '21px',
    description: '21 px, section heading',
  },
  {
    name: '--oref-font-size-700',
    group: 'font',
    value: '27px',
    description: '27 px, page heading',
  },
  {
    name: '--oref-font-size-800',
    group: 'font',
    value: '44px',
    description: '44 px, display',
  },
  {
    name: '--oref-font-size-900',
    group: 'font',
    value: '64px',
    description: '64 px, hero numeral',
  },
  {
    name: '--oref-font-leading-tight',
    group: 'font',
    value: '1.25',
    description: 'Line height of a heading',
  },
  {
    name: '--oref-font-leading-data',
    group: 'font',
    value: '1.45',
    description: 'Line height of a table row or a schema line',
  },
  {
    name: '--oref-font-leading-prose',
    group: 'font',
    value: '1.62',
    description: 'Line height of long prose',
  },
  {
    name: '--oref-font-tracking-wide',
    group: 'font',
    value: '0.22em',
    description: 'Letter spacing of a micro label in caps',
  },
  {
    name: '--oref-font-tracking-mid',
    group: 'font',
    value: '0.12em',
    description: 'Letter spacing of a small label in caps',
  },
  {
    name: '--oref-font-tracking-head',
    group: 'font',
    value: '-0.02em',
    description: 'Letter spacing of a heading, negative',
  },

  // Spacing. Ten steps, tighter at the bottom than a linear scale, because a dense
  // instrument spends most of its space below 20 px.
  {
    name: '--oref-space-100',
    group: 'space',
    value: '2px',
    description: '2 px',
  },
  {
    name: '--oref-space-200',
    group: 'space',
    value: '4px',
    description: '4 px',
  },
  {
    name: '--oref-space-300',
    group: 'space',
    value: '6px',
    description: '6 px',
  },
  {
    name: '--oref-space-400',
    group: 'space',
    value: '10px',
    description: '10 px',
  },
  {
    name: '--oref-space-500',
    group: 'space',
    value: '14px',
    description: '14 px',
  },
  {
    name: '--oref-space-600',
    group: 'space',
    value: '20px',
    description: '20 px',
  },
  {
    name: '--oref-space-700',
    group: 'space',
    value: '26px',
    description: '26 px',
  },
  {
    name: '--oref-space-800',
    group: 'space',
    value: '36px',
    description: '36 px',
  },
  {
    name: '--oref-space-900',
    group: 'space',
    value: '52px',
    description: '52 px',
  },
  {
    name: '--oref-space-1000',
    group: 'space',
    value: '80px',
    description: '80 px',
  },

  // Radius. The scale is core even though this theme rounds nothing, so a component may
  // write radius-md without breaking in a square theme.
  {
    name: '--oref-radius-none',
    group: 'radius',
    value: '0px',
    description: 'Square, and the only value this theme uses',
  },
  {
    name: '--oref-radius-sm',
    group: 'radius',
    value: '0px',
    description: 'Badge and tag',
  },
  {
    name: '--oref-radius-md',
    group: 'radius',
    value: '0px',
    description: 'Button, input and card',
  },
  {
    name: '--oref-radius-lg',
    group: 'radius',
    value: '0px',
    description: 'Panel and dialog',
  },
  {
    name: '--oref-radius-pill',
    group: 'radius',
    value: '0px',
    description: 'Pill',
  },

  // Border widths.
  {
    name: '--oref-border-hair',
    group: 'border',
    value: '1px',
    description: 'Hairline separator and control boundary',
  },
  {
    name: '--oref-border-mark',
    group: 'border',
    value: '3px',
    description: 'Provenance edge on the left of a row',
  },

  // Shadows. This theme builds depth from lines and lightness, so both are none.
  {
    name: '--oref-shadow-panel',
    group: 'shadow',
    value: 'none',
    description: 'Panel and card',
  },
  {
    name: '--oref-shadow-overlay',
    group: 'shadow',
    value: 'none',
    description: 'Popover, dropdown and dialog',
  },

  // Focus ring. Never removed, only restyled.
  {
    name: '--oref-focus-color',
    group: 'focus',
    value: '#8a5200',
    dark: '#ffb020',
    description: 'Focus ring, never removed, only restyled',
  },
  {
    name: '--oref-focus-width',
    group: 'focus',
    value: '2px',
    description: 'Thickness of the focus ring',
  },
  {
    name: '--oref-focus-offset',
    group: 'focus',
    value: '-2px',
    description: 'Offset of the focus ring; a negative value draws it inward',
  },

  // Layout. Core carries the two measurements every theme needs; anything else a theme
  // needs is its own token.
  {
    name: '--oref-layout-rail',
    group: 'layout',
    value: '268px',
    description: 'Width of the navigation rail',
  },
  {
    name: '--oref-layout-measure',
    group: 'layout',
    value: '78ch',
    description: 'Greatest measure of the content column',
  },

  // Provenance, per SPEC 6.1. Three levels, each with an ink, a background, an edge style
  // and a three letter code, so the level survives monochrome print.
  {
    name: '--oref-prov-declared-fg',
    group: 'prov',
    value: '#1f57ab',
    dark: '#8fbcff',
    description: 'Declared, an explicit decorator: ink',
  },
  {
    name: '--oref-prov-declared-bg',
    group: 'prov',
    value: '#e6eefb',
    dark: '#0e1a2a',
    description: 'Declared: background',
  },
  {
    name: '--oref-prov-declared-border-style',
    group: 'prov',
    value: 'solid',
    description: 'Declared: style of the left edge, so the level reads without colour',
  },
  {
    name: '--oref-prov-declared-code',
    group: 'prov',
    value: "'DCL'",
    description: 'Declared: the three letter code, for monochrome print',
  },
  {
    name: '--oref-prov-derived-fg',
    group: 'prov',
    value: '#8a5200',
    dark: '#ffb020',
    description: 'Derived, metadata under a known key: ink',
  },
  {
    name: '--oref-prov-derived-bg',
    group: 'prov',
    value: '#f9efdc',
    dark: '#1f1607',
    description: 'Derived: background',
  },
  {
    name: '--oref-prov-derived-border-style',
    group: 'prov',
    value: 'dashed',
    description: 'Derived: style of the left edge',
  },
  {
    name: '--oref-prov-derived-code',
    group: 'prov',
    value: "'DRV'",
    description: 'Derived: the three letter code',
  },
  {
    name: '--oref-prov-inferred-fg',
    group: 'prov',
    value: '#5b3ba8',
    dark: '#b98cff',
    description: 'Inferred, best effort from the AST plugin: ink',
  },
  {
    name: '--oref-prov-inferred-bg',
    group: 'prov',
    value: '#efe9fb',
    dark: '#170f26',
    description: 'Inferred: background',
  },
  {
    name: '--oref-prov-inferred-border-style',
    group: 'prov',
    value: 'dotted',
    description: 'Inferred: style of the left edge',
  },
  {
    name: '--oref-prov-inferred-code',
    group: 'prov',
    value: "'INF'",
    description: 'Inferred: the three letter code',
  },

  // States: response classes and check results.
  {
    name: '--oref-state-ok-fg',
    group: 'state',
    value: '#0b6b45',
    dark: '#3fd18b',
    description: 'A 2xx response, a passing check: ink',
  },
  {
    name: '--oref-state-ok-bg',
    group: 'state',
    value: '#e2f2ea',
    dark: '#08201a',
    description: 'A 2xx response, a passing check: background',
  },
  {
    name: '--oref-state-warn-fg',
    group: 'state',
    value: '#8a5200',
    dark: '#ffb020',
    description: 'A 3xx response, a deprecation, a warning: ink',
  },
  {
    name: '--oref-state-warn-bg',
    group: 'state',
    value: '#f9efdc',
    dark: '#1f1607',
    description: 'A 3xx response, a deprecation, a warning: background',
  },
  {
    name: '--oref-state-crit-fg',
    group: 'state',
    value: '#a92616',
    dark: '#ff5a47',
    description: 'A 4xx or 5xx response, a failing check: ink',
  },
  {
    name: '--oref-state-crit-bg',
    group: 'state',
    value: '#fae7e4',
    dark: '#230d0c',
    description: 'A 4xx or 5xx response, a failing check: background',
  },
  {
    name: '--oref-state-info-fg',
    group: 'state',
    value: '#1f57ab',
    dark: '#8fbcff',
    description: 'A 1xx response, an informational note: ink',
  },
  {
    name: '--oref-state-info-bg',
    group: 'state',
    value: '#e6eefb',
    dark: '#0e1a2a',
    description: 'A 1xx response, an informational note: background',
  },
  {
    name: '--oref-state-muted-fg',
    group: 'state',
    value: '#6b7d8d',
    dark: '#5f7284',
    description: 'A state with nothing to report: ink',
  },
  {
    name: '--oref-state-muted-bg',
    group: 'state',
    value: '#eaeef1',
    dark: '#111820',
    description: 'A state with nothing to report: background',
  },

  // Drift severity, per SPEC 7.1. The edge width carries the severity as well as the
  // colour does.
  {
    name: '--oref-drift-crit-fg',
    group: 'drift',
    value: '#a92616',
    dark: '#ff5a47',
    description: 'Drift of severity error: ink',
  },
  {
    name: '--oref-drift-crit-bg',
    group: 'drift',
    value: '#fae7e4',
    dark: '#230d0c',
    description: 'Drift of severity error: background',
  },
  {
    name: '--oref-drift-crit-border-width',
    group: 'drift',
    value: '2px',
    description: 'Drift of severity error: edge thickness, the widest of the three',
  },
  {
    name: '--oref-drift-crit-border-style',
    group: 'drift',
    value: 'solid',
    description: 'Drift of severity error: edge style',
  },
  {
    name: '--oref-drift-warn-fg',
    group: 'drift',
    value: '#8a5200',
    dark: '#ffb020',
    description: 'Drift of severity warning: ink',
  },
  {
    name: '--oref-drift-warn-bg',
    group: 'drift',
    value: '#f9efdc',
    dark: '#1f1607',
    description: 'Drift of severity warning: background',
  },
  {
    name: '--oref-drift-warn-border-width',
    group: 'drift',
    value: '1px',
    description: 'Drift of severity warning: edge thickness',
  },
  {
    name: '--oref-drift-warn-border-style',
    group: 'drift',
    value: 'dashed',
    description: 'Drift of severity warning: edge style',
  },
  {
    name: '--oref-drift-note-fg',
    group: 'drift',
    value: '#465768',
    dark: '#93a4b3',
    description: 'Drift of severity info: ink',
  },
  {
    name: '--oref-drift-note-bg',
    group: 'drift',
    value: '#eaeef1',
    dark: '#111820',
    description: 'Drift of severity info: background',
  },
  {
    name: '--oref-drift-note-border-width',
    group: 'drift',
    value: '1px',
    description: 'Drift of severity info: edge thickness',
  },
  {
    name: '--oref-drift-note-border-style',
    group: 'drift',
    value: 'dotted',
    description: 'Drift of severity info: edge style',
  },

  // Motion. Two durations, a zero and a curve. Under prefers-reduced-motion the two
  // durations alias the zero, which is done in the token stylesheet rather than left to each
  // theme: see `MOTION_DURATION_TOKENS` below and the contract section that decided it.
  {
    name: '--oref-motion-duration-fast',
    group: 'motion',
    value: '80ms',
    description: 'A state change the reader caused and is looking at: hover, press, focus',
  },
  {
    name: '--oref-motion-duration-base',
    group: 'motion',
    value: '160ms',
    description: 'Something entering or leaving: a panel, a dialog, a disclosure',
  },
  {
    name: '--oref-motion-duration-none',
    group: 'motion',
    value: '0s',
    description: 'No motion, and what the two durations resolve to under reduced motion',
  },
  {
    name: '--oref-motion-easing-standard',
    group: 'motion',
    value: 'cubic-bezier(0.2, 0, 0.13, 1)',
    description: 'The curve every transition uses; a zero duration has no curve to run',
  },

  // Scrim. The dark value is denser than the light one on purpose, and the blur is a theme's
  // own answer rather than a shared default. Both reasons are in the design notes.
  {
    name: '--oref-scrim-blur',
    group: 'scrim',
    value: '0px',
    description: 'Blur applied to what is behind a modal; 0 in a flat theme, and a decision',
  },
];

/**
 * The motion tokens that carry a duration, and the one they collapse to.
 *
 * Named here rather than matched by shape, because the reduced motion block is generated from
 * this list and a duration that fell out of it would silently keep moving. `--oref-motion-easing-standard`
 * is deliberately absent: it is a curve, and a transition of zero duration has none to run.
 */
export const MOTION_ZERO_TOKEN = '--oref-motion-duration-none';

export const MOTION_DURATION_TOKENS: readonly string[] = [
  '--oref-motion-duration-fast',
  '--oref-motion-duration-base',
  MOTION_ZERO_TOKEN,
];

/**
 * Tokens this theme adds on top of the core set.
 *
 * The contract allows them and names vernier's two. They are kept apart from
 * {@link THEME_TOKENS} rather than mixed in, because the core set is a contract of exactly 103
 * names and a theme's own token must never be mistaken for one of them. A component in the
 * reference must not read a token from this array.
 */
export const THEME_SPECIFIC_TOKENS: readonly ThemeToken[] = [
  {
    name: '--oref-layout-gutter',
    group: 'layout',
    value: '44px',
    description: 'Width of the ruler gutter between the specification and runtime columns',
  },
  {
    name: '--oref-layout-tick',
    group: 'layout',
    value:
      'repeating-linear-gradient(180deg, var(--oref-color-line-edge) 0 1px, transparent 1px 8px)',
    description: 'The ruler itself, drawn as a repeating gradient of the edge colour',
  },
  {
    name: '--oref-layout-nav-row',
    group: 'layout',
    value: '27px',
    description:
      'Height of one navigation row, which is what an unrendered chunk of the virtualized sidebar reserves',
  },
];

/** Every token the stylesheet declares: the core set followed by this theme's own. */
export const ALL_TOKENS: readonly ThemeToken[] = [...THEME_TOKENS, ...THEME_SPECIFIC_TOKENS];

/** Token values in the default, light colour scheme, keyed by custom property name. */
export const LIGHT_TOKEN_VALUES: Readonly<Record<string, string>> = Object.fromEntries(
  ALL_TOKENS.map((token) => [token.name, token.value]),
);

/** Token values with the dark colour scheme applied over the defaults. */
export const DARK_TOKEN_VALUES: Readonly<Record<string, string>> = Object.fromEntries(
  ALL_TOKENS.map((token) => [token.name, token.dark ?? token.value]),
);

/**
 * The colour pairs the default theme actually puts together, with the role of each.
 *
 * A pair is listed here because the stylesheet draws one on the other, not because the two
 * exist. Contrast is asserted over this list, so a pair that is added to the stylesheet and
 * not to this list is a gap, and `tokens.spec.ts` fails on a pair naming a token that is gone.
 *
 * The three inks against the three surfaces, and the two inks that sit on an accent
 * background, are required by the design contract rather than chosen here. `fg-muted` is the
 * ink with the least headroom in every theme, so it is the one to re-check after any palette
 * change.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = (
  [
    ['--oref-color-fg', '--oref-color-bg', 'text'],
    ['--oref-color-fg', '--oref-color-surface', 'text'],
    ['--oref-color-fg', '--oref-color-surface-inset', 'text'],
    ['--oref-color-fg-secondary', '--oref-color-bg', 'text'],
    ['--oref-color-fg-secondary', '--oref-color-surface', 'text'],
    ['--oref-color-fg-secondary', '--oref-color-surface-inset', 'text'],
    ['--oref-color-fg-secondary', '--oref-state-muted-bg', 'text'],
    ['--oref-color-fg-muted', '--oref-color-bg', 'text'],
    ['--oref-color-fg-muted', '--oref-color-surface', 'text'],
    ['--oref-color-fg-muted', '--oref-color-surface-inset', 'text'],
    ['--oref-color-fg', '--oref-color-accent-bg', 'text'],
    ['--oref-color-fg-secondary', '--oref-color-accent-bg', 'text'],
    ['--oref-color-fg-muted', '--oref-color-accent-bg', 'text'],
    ['--oref-color-fg', '--oref-color-accent-soft', 'text'],
    ['--oref-color-fg', '--oref-color-surface-code', 'text'],
    ['--oref-color-accent-spec', '--oref-color-bg', 'text'],
    ['--oref-color-accent-link', '--oref-color-bg', 'text'],
    ['--oref-color-accent-runtime', '--oref-color-bg', 'text'],
    ['--oref-color-fg-inverse', '--oref-color-accent-spec', 'text'],
    // The send button of the try-it console, added in T013. It is the only solid runtime
    // coloured surface with text on it, and the only new claim that block makes: everything
    // else it draws is fg, fg-secondary or fg-muted on a surface already listed above.
    ['--oref-color-fg-inverse', '--oref-color-accent-runtime', 'text'],
    ['--oref-color-fg-inverse', '--oref-color-method-get', 'text'],
    ['--oref-color-fg-inverse', '--oref-color-method-post', 'text'],
    ['--oref-color-fg-inverse', '--oref-color-method-put', 'text'],
    ['--oref-color-fg-inverse', '--oref-color-method-patch', 'text'],
    ['--oref-color-fg-inverse', '--oref-color-method-delete', 'text'],
    ['--oref-color-fg-inverse', '--oref-color-method-sse', 'text'],
    ['--oref-color-fg-inverse', '--oref-color-method-event', 'text'],
    ['--oref-state-ok-fg', '--oref-state-ok-bg', 'text'],
    ['--oref-state-warn-fg', '--oref-state-warn-bg', 'text'],
    ['--oref-state-crit-fg', '--oref-state-crit-bg', 'text'],
    ['--oref-state-info-fg', '--oref-state-info-bg', 'text'],
    ['--oref-state-muted-fg', '--oref-state-muted-bg', 'large'],
    ['--oref-prov-declared-fg', '--oref-prov-declared-bg', 'text'],
    ['--oref-prov-derived-fg', '--oref-prov-derived-bg', 'text'],
    ['--oref-prov-inferred-fg', '--oref-prov-inferred-bg', 'text'],
    ['--oref-drift-crit-fg', '--oref-drift-crit-bg', 'text'],
    ['--oref-drift-warn-fg', '--oref-drift-warn-bg', 'text'],
    ['--oref-drift-note-fg', '--oref-drift-note-bg', 'text'],
    // line-strong claims nothing. The supplied palette measures it at 2.31 against the page in
    // light and 2.19 in dark, so it cannot carry the 3:1 that WCAG 1.4.11 asks of the boundary
    // of a control, and this theme therefore does not draw one with it. fg-muted does, and it
    // is claimed at the text threshold two lines above. The palette itself is a question for
    // the designer, recorded in PROJECT_STATE rather than answered by relabelling the role.
    ['--oref-color-line-strong', '--oref-color-bg', 'decorative'],
    ['--oref-focus-color', '--oref-color-bg', 'large'],
    ['--oref-color-line', '--oref-color-bg', 'decorative'],
    ['--oref-color-line-edge', '--oref-color-bg', 'decorative'],
  ] as const
).flatMap(([foreground, background, role]) =>
  (['light', 'dark'] as const).map((scheme) => ({ foreground, background, role, scheme })),
);
