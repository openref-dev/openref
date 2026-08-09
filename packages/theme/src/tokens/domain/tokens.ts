import type { ContrastPair, ThemeToken } from './token.types';

/**
 * The default token set.
 *
 * These are neutral defaults, not a visual language. `ai-docs/design/` does not exist yet, and
 * BUILD T009 is explicit that inventing one here is out of scope: T010 maps a supplied design
 * onto exactly these names once it arrives. Anything chosen here that the design contradicts
 * is a value change, never a contract change.
 *
 * This file and `styles/tokens.css` are the only places in the package where a literal colour,
 * length or font stack may appear. Everywhere else reads `var(--oref-*)`, and a gate fails the
 * build on a literal that escapes. `tokens.css` is generated from this array and pinned by a
 * test, so the two cannot drift.
 */
export const THEME_TOKENS: readonly ThemeToken[] = [
  // Colour: surfaces
  {
    name: '--oref-color-bg',
    group: 'color',
    value: '#ffffff',
    dark: '#0d1117',
    description: 'Page background',
  },
  {
    name: '--oref-color-bg-subtle',
    group: 'color',
    value: '#f6f7f9',
    dark: '#161b22',
    description: 'Recessed surface: sidebar, table header, code block',
  },
  {
    name: '--oref-color-bg-raised',
    group: 'color',
    value: '#ffffff',
    dark: '#161b22',
    description: 'Raised surface: panel, popover, dialog',
  },
  {
    name: '--oref-color-bg-overlay',
    group: 'color',
    value: 'rgba(27, 31, 36, 0.5)',
    dark: 'rgba(1, 4, 9, 0.7)',
    description: 'Scrim behind a modal surface',
  },

  // Colour: text
  {
    name: '--oref-color-fg',
    group: 'color',
    value: '#1b1f24',
    dark: '#e6edf3',
    description: 'Body text',
  },
  {
    name: '--oref-color-fg-muted',
    group: 'color',
    value: '#57606a',
    dark: '#9aa7b4',
    description: 'Secondary text: descriptions, metadata',
  },
  {
    name: '--oref-color-fg-subtle',
    group: 'color',
    value: '#6a737d',
    dark: '#8b949e',
    description: 'Tertiary text: placeholders, disabled labels',
  },

  // Colour: lines
  {
    name: '--oref-color-border',
    group: 'color',
    value: '#d0d7de',
    dark: '#30363d',
    description: 'Decorative separator, no contrast claim',
  },
  {
    name: '--oref-color-border-strong',
    group: 'color',
    value: '#8c959f',
    dark: '#6e7681',
    description: 'Boundary of a control, which must stay distinguishable',
  },

  // Colour: accent and state
  {
    name: '--oref-color-accent',
    group: 'color',
    value: '#0b5fd0',
    dark: '#6aa9ff',
    description: 'Primary action and active navigation',
  },
  {
    name: '--oref-color-accent-fg',
    group: 'color',
    value: '#ffffff',
    dark: '#0d1117',
    description: 'Text drawn on the accent colour',
  },
  {
    name: '--oref-color-focus',
    group: 'color',
    value: '#0b5fd0',
    dark: '#6aa9ff',
    description: 'Focus ring, never removed, only restyled',
  },
  {
    name: '--oref-color-success',
    group: 'color',
    value: '#116329',
    dark: '#4cc38a',
    description: 'A 2xx response, a passing check',
  },
  {
    name: '--oref-color-warning',
    group: 'color',
    value: '#7a4a00',
    dark: '#e3b341',
    description: 'A 3xx response, a deprecation, a drift warning',
  },
  {
    name: '--oref-color-danger',
    group: 'color',
    value: '#a40e26',
    dark: '#ff8189',
    description: 'A 4xx or 5xx response, a drift error',
  },
  {
    name: '--oref-color-info',
    group: 'color',
    value: '#0b5fd0',
    dark: '#6aa9ff',
    description: 'A 1xx response, an informational note',
  },

  // Colour: HTTP methods
  {
    name: '--oref-color-method-get',
    group: 'color',
    value: '#0b5fd0',
    dark: '#6aa9ff',
    description: 'GET badge',
  },
  {
    name: '--oref-color-method-post',
    group: 'color',
    value: '#116329',
    dark: '#4cc38a',
    description: 'POST badge',
  },
  {
    name: '--oref-color-method-put',
    group: 'color',
    value: '#7a4a00',
    dark: '#e3b341',
    description: 'PUT badge',
  },
  {
    name: '--oref-color-method-patch',
    group: 'color',
    value: '#6639ba',
    dark: '#c297ff',
    description: 'PATCH badge',
  },
  {
    name: '--oref-color-method-delete',
    group: 'color',
    value: '#a40e26',
    dark: '#ff8189',
    description: 'DELETE badge',
  },
  {
    name: '--oref-color-method-other',
    group: 'color',
    value: '#57606a',
    dark: '#9aa7b4',
    description: 'Any other method, including the open set of OpenAPI 3.2',
  },

  // Spacing, on a 4 px step
  { name: '--oref-space-0', group: 'space', value: '0', description: 'No space' },
  { name: '--oref-space-1', group: 'space', value: '0.25rem', description: '4 px' },
  { name: '--oref-space-2', group: 'space', value: '0.5rem', description: '8 px' },
  { name: '--oref-space-3', group: 'space', value: '0.75rem', description: '12 px' },
  { name: '--oref-space-4', group: 'space', value: '1rem', description: '16 px' },
  { name: '--oref-space-5', group: 'space', value: '1.5rem', description: '24 px' },
  { name: '--oref-space-6', group: 'space', value: '2rem', description: '32 px' },
  { name: '--oref-space-7', group: 'space', value: '3rem', description: '48 px' },

  // Typography
  {
    name: '--oref-font-family-sans',
    group: 'font',
    value:
      "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
    description: 'Interface text. A system stack, so nothing is fetched from a third party',
  },
  {
    name: '--oref-font-family-mono',
    group: 'font',
    value: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
    description: 'Paths, schemas, code and samples',
  },
  { name: '--oref-font-size-xs', group: 'font', value: '0.75rem', description: '12 px' },
  { name: '--oref-font-size-sm', group: 'font', value: '0.875rem', description: '14 px' },
  { name: '--oref-font-size-md', group: 'font', value: '1rem', description: '16 px, body' },
  { name: '--oref-font-size-lg', group: 'font', value: '1.125rem', description: '18 px' },
  { name: '--oref-font-size-xl', group: 'font', value: '1.375rem', description: '22 px' },
  { name: '--oref-font-size-2xl', group: 'font', value: '1.75rem', description: '28 px' },
  { name: '--oref-font-weight-regular', group: 'font', value: '400', description: 'Body' },
  { name: '--oref-font-weight-medium', group: 'font', value: '500', description: 'Emphasis' },
  { name: '--oref-font-weight-bold', group: 'font', value: '650', description: 'Headings' },
  { name: '--oref-font-line-tight', group: 'font', value: '1.25', description: 'Headings' },
  { name: '--oref-font-line-normal', group: 'font', value: '1.5', description: 'Body' },
  { name: '--oref-font-line-relaxed', group: 'font', value: '1.7', description: 'Long prose' },
  {
    name: '--oref-font-tracking-wide',
    group: 'font',
    value: '0.04em',
    description: 'Letter spacing of an uppercase label',
  },

  // Radius
  { name: '--oref-radius-sm', group: 'radius', value: '3px', description: 'Badge, tag' },
  { name: '--oref-radius-md', group: 'radius', value: '6px', description: 'Button, input, card' },
  { name: '--oref-radius-lg', group: 'radius', value: '10px', description: 'Panel, dialog' },
  { name: '--oref-radius-full', group: 'radius', value: '9999px', description: 'Pill' },

  // Elevation
  {
    name: '--oref-elevation-0',
    group: 'elevation',
    value: 'none',
    description: 'Flat, on the page surface',
  },
  {
    name: '--oref-elevation-1',
    group: 'elevation',
    value: '0 1px 2px rgba(27, 31, 36, 0.12)',
    dark: '0 1px 2px rgba(1, 4, 9, 0.6)',
    description: 'Card, table row hover',
  },
  {
    name: '--oref-elevation-2',
    group: 'elevation',
    value: '0 4px 12px rgba(27, 31, 36, 0.14)',
    dark: '0 4px 12px rgba(1, 4, 9, 0.7)',
    description: 'Popover, dropdown',
  },
  {
    name: '--oref-elevation-3',
    group: 'elevation',
    value: '0 12px 32px rgba(27, 31, 36, 0.18)',
    dark: '0 12px 32px rgba(1, 4, 9, 0.8)',
    description: 'Dialog',
  },

  // Motion. Every duration is honoured only outside a reduced motion preference.
  { name: '--oref-motion-fast', group: 'motion', value: '80ms', description: 'Hover, focus' },
  {
    name: '--oref-motion-normal',
    group: 'motion',
    value: '160ms',
    description: 'Disclosure, tab change',
  },
  {
    name: '--oref-motion-none',
    group: 'motion',
    value: '0s',
    description: 'Duration under a reduced motion preference',
  },
  {
    name: '--oref-motion-ease',
    group: 'motion',
    value: 'cubic-bezier(0.2, 0, 0.13, 1)',
    description: 'Default easing',
  },

  // Layout
  {
    name: '--oref-layout-sidebar-width',
    group: 'layout',
    value: '17rem',
    description: 'Width of the navigation column',
  },
  {
    name: '--oref-layout-content-max',
    group: 'layout',
    value: '54rem',
    description: 'Greatest measure of the content column',
  },
  {
    name: '--oref-layout-border-width',
    group: 'layout',
    value: '1px',
    description: 'Thickness of a separator or a control boundary',
  },
  {
    name: '--oref-layout-focus-ring',
    group: 'layout',
    value: '2px',
    description: 'Thickness of the focus ring',
  },
];

/** Token values in the default, light colour scheme, keyed by custom property name. */
export const LIGHT_TOKEN_VALUES: Readonly<Record<string, string>> = Object.fromEntries(
  THEME_TOKENS.map((token) => [token.name, token.value]),
);

/** Token values with the dark colour scheme applied over the defaults. */
export const DARK_TOKEN_VALUES: Readonly<Record<string, string>> = Object.fromEntries(
  THEME_TOKENS.map((token) => [token.name, token.dark ?? token.value]),
);

/**
 * The colour pairs the default theme actually puts together, with the role of each.
 *
 * A pair is listed here because the stylesheet draws one on the other, not because the two
 * exist. Contrast is asserted over this list, so a pair that is added to the stylesheet and
 * not to this list is a gap, and `tokens.spec.ts` fails on a pair naming a token that is gone.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = (
  [
    ['--oref-color-fg', '--oref-color-bg', 'text'],
    ['--oref-color-fg', '--oref-color-bg-subtle', 'text'],
    ['--oref-color-fg', '--oref-color-bg-raised', 'text'],
    ['--oref-color-fg-muted', '--oref-color-bg', 'text'],
    ['--oref-color-fg-muted', '--oref-color-bg-subtle', 'text'],
    ['--oref-color-fg-subtle', '--oref-color-bg', 'text'],
    ['--oref-color-accent', '--oref-color-bg', 'text'],
    ['--oref-color-accent', '--oref-color-bg-subtle', 'text'],
    ['--oref-color-accent-fg', '--oref-color-accent', 'text'],
    ['--oref-color-success', '--oref-color-bg', 'text'],
    ['--oref-color-warning', '--oref-color-bg', 'text'],
    ['--oref-color-danger', '--oref-color-bg', 'text'],
    ['--oref-color-info', '--oref-color-bg', 'text'],
    ['--oref-color-method-get', '--oref-color-bg', 'text'],
    ['--oref-color-method-post', '--oref-color-bg', 'text'],
    ['--oref-color-method-put', '--oref-color-bg', 'text'],
    ['--oref-color-method-patch', '--oref-color-bg', 'text'],
    ['--oref-color-method-delete', '--oref-color-bg', 'text'],
    ['--oref-color-method-other', '--oref-color-bg', 'text'],
    ['--oref-color-border-strong', '--oref-color-bg', 'large'],
    ['--oref-color-focus', '--oref-color-bg', 'large'],
    ['--oref-color-border', '--oref-color-bg', 'decorative'],
  ] as const
).flatMap(([foreground, background, role]) =>
  (['light', 'dark'] as const).map((scheme) => ({ foreground, background, role, scheme })),
);
