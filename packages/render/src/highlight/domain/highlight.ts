/**
 * Syntax highlighting, on the server and only on the server.
 *
 * Shiki carries a grammar and a theme per language and is measured in hundreds of
 * kilobytes. SPEC 12 keeps it out of the client bundle, which is why highlighting happens
 * while the page model is built rather than while the page is rendered: the browser
 * receives markup, never a highlighter.
 *
 * The output carries classes and never a `style` attribute. Shiki's default HTML writes
 * the resolved colour inline, which a strict policy cannot authorize, so the CSS variables
 * theme is used and every variable is mapped to a class. A theme decides what those
 * classes look like; this package decides nothing about colour.
 *
 * SHIKI IS LOADED WITH A DYNAMIC IMPORT AND THAT IS NOT A LAZINESS OPTIMISATION. Shiki 4
 * publishes ESM only, with no `require` condition. This package is bundled into
 * `@openref/nest`, which ships CJS as well as ESM, and a static import becomes `require()`
 * in the CJS half: `ERR_REQUIRE_ESM` in the project of anyone whose NestJS application is
 * CommonJS, which SPEC 23 names as inadmissible. `import()` works from both module systems
 * on every Node this project supports, and esbuild leaves it alone for an external package.
 */

import type { BundledLanguage } from 'shiki';
import { escapeHtml } from '../../shared/html';

/** Languages a specification realistically writes a fenced block in. */
export const HIGHLIGHT_LANGUAGES: readonly BundledLanguage[] = [
  'bash',
  'graphql',
  'html',
  'http',
  'java',
  'javascript',
  'json',
  'jsonc',
  'markdown',
  'php',
  'python',
  'ruby',
  'sql',
  'typescript',
  'xml',
  'yaml',
];

/** Prefix of every class the highlighter emits, and of the CSS variables behind them. */
export const HIGHLIGHT_CLASS_PREFIX = 'oref-hl-';

const THEME_NAME = 'oref-css-variables';
const VARIABLE_PREFIX = `--${HIGHLIGHT_CLASS_PREFIX}`;

/** Bit values shiki uses for font style, from its `FontStyle` enum. */
const FONT_STYLE_ITALIC = 1;
const FONT_STYLE_BOLD = 2;
const FONT_STYLE_UNDERLINE = 4;

/**
 * A highlighter, narrowed to what this package uses.
 *
 * Declaring the port rather than passing shiki's own type around is what lets a test drive
 * the markdown renderer without loading a grammar, and what keeps the shape of the
 * dependency visible in one file.
 */
export interface IHighlighter {
  /** Languages this highlighter can actually highlight. */
  readonly languages: readonly string[];
  /**
   * @param code - Source text of a fenced block
   * @param language - Language as written after the fence, may be unknown or absent
   * @returns HTML for a `pre` element, with classes and no inline styles
   */
  highlight(code: string, language: string | undefined): string;
}

/**
 * Maps a shiki colour to a class name.
 *
 * With the CSS variables theme every colour is `var(--oref-hl-<name>)`, a fixed and small
 * set. Anything else, including a literal colour from a theme that is not the one this
 * module installs, yields no class at all rather than an inline style. Losing a colour is
 * a visual defect; emitting a style attribute is a policy violation.
 *
 * @param color - Colour as shiki reports it for a token
 * @returns Class name, or null when the token takes the default colour
 */
export function tokenClass(color: string | undefined): string | null {
  if (color === undefined) return null;

  const match = /^var\((--[a-z0-9-]+)\)$/i.exec(color.trim());
  if (match === null) return null;

  const variable = match[1] ?? '';
  if (!variable.startsWith(VARIABLE_PREFIX)) return null;

  const name = variable.slice(VARIABLE_PREFIX.length).replace(/^token-/, '');
  if (name === '' || name === 'foreground' || name === 'background') return null;

  return `${HIGHLIGHT_CLASS_PREFIX}${name}`;
}

/**
 * Maps shiki's font style bitmask to classes.
 *
 * @param fontStyle - Bitmask as shiki reports it, or undefined
 * @returns Class names, in a fixed order so the output stays deterministic
 */
export function fontStyleClasses(fontStyle: number | undefined): string[] {
  if (fontStyle === undefined || fontStyle <= 0) return [];

  const classes: string[] = [];
  if ((fontStyle & FONT_STYLE_ITALIC) !== 0) classes.push(`${HIGHLIGHT_CLASS_PREFIX}italic`);
  if ((fontStyle & FONT_STYLE_BOLD) !== 0) classes.push(`${HIGHLIGHT_CLASS_PREFIX}bold`);
  if ((fontStyle & FONT_STYLE_UNDERLINE) !== 0) classes.push(`${HIGHLIGHT_CLASS_PREFIX}underline`);

  return classes;
}

/**
 * Wraps code in the markup every path in this package produces, highlighted or not.
 *
 * @param body - Already escaped inner HTML of the `code` element
 * @param language - Language name, or undefined when there is none
 * @returns HTML for one `pre` element
 */
export function codeBlockHtml(body: string, language: string | undefined): string {
  const attribute = language === undefined ? '' : ` data-oref-lang="${escapeHtml(language)}"`;
  return `<pre class="oref-code"${attribute}><code>${body}</code></pre>`;
}

/**
 * A highlighter that highlights nothing.
 *
 * Used when no language matches and as the default of the markdown renderer, so a caller
 * that has not built a highlighter still produces correct, escaped markup instead of
 * either throwing or passing code through unescaped.
 */
export const plainHighlighter: IHighlighter = {
  languages: [],
  highlight(code, language) {
    return codeBlockHtml(escapeHtml(code), language);
  },
};

/**
 * Reports whether a name is one shiki bundles a grammar for.
 *
 * A guard against shiki's own registry rather than an assertion. The language comes out of
 * a fenced block in a third party document, so it is untrusted input, and narrowing it by
 * assertion would be trusting that document about what a library supports.
 *
 * ASYNCHRONOUS BECAUSE THE REGISTRY IS LOADED ON DEMAND, per the note on the imports above.
 * The synchronous shape would have needed a module level cache of the registry, which reads
 * as false for every language until something else happens to have loaded shiki, and a guard
 * whose answer depends on load order is worse than one that has to be awaited.
 *
 * @param name - Language as written after a fence
 * @returns True when shiki bundles a grammar or an alias under that name
 */
export async function isBundledLanguage(name: string): Promise<boolean> {
  const { bundledLanguages } = await import('shiki');
  return Object.hasOwn(bundledLanguages, name);
}

/**
 * Builds the highlighter used on the server.
 *
 * Loading grammars is slow and the result is immutable, so a process builds one and passes
 * it in. This module deliberately holds no singleton: a module level cache would be shared
 * state that tests cannot reset and that a long lived server cannot size.
 *
 * @param languages - Languages to load, defaulting to {@link HIGHLIGHT_LANGUAGES}
 * @returns A highlighter over those languages
 */
export async function createOpenRefHighlighter(
  languages: readonly BundledLanguage[] = HIGHLIGHT_LANGUAGES,
): Promise<IHighlighter> {
  const { bundledLanguages, createCssVariablesTheme, createHighlighter } = await import('shiki');

  const theme = createCssVariablesTheme({
    name: THEME_NAME,
    variablePrefix: VARIABLE_PREFIX,
    variableDefaults: {},
    fontStyle: true,
  });

  const shiki = await createHighlighter({
    themes: [theme],
    langs: [...languages],
  });

  /**
   * The same question {@link isBundledLanguage} answers, asked against the registry this
   * call already holds. It is a type predicate rather than a boolean because shiki types
   * `codeToTokens` by its bundled language union, and it is local because a predicate
   * cannot be awaited at the call site inside a synchronous `highlight`.
   */
  const isBundled = (name: string): name is BundledLanguage =>
    Object.hasOwn(bundledLanguages, name);

  // Aliases count: a fence written ```js has to highlight as JavaScript. Shiki reports
  // them among the loaded languages, so no table of aliases is kept here.
  const loaded = new Set(shiki.getLoadedLanguages());

  return {
    languages: [...loaded].sort((a, b) => a.localeCompare(b)),

    highlight(code, language) {
      if (language === undefined || !loaded.has(language) || !isBundled(language)) {
        return plainHighlighter.highlight(code, language);
      }

      const { tokens } = shiki.codeToTokens(code, { lang: language, theme: THEME_NAME });

      const lines = tokens.map((line) => {
        const spans = line.map((token) => {
          const classes = [tokenClass(token.color), ...fontStyleClasses(token.fontStyle)].filter(
            (name): name is string => name !== null,
          );
          const text = escapeHtml(token.content);
          return classes.length === 0 ? text : `<span class="${classes.join(' ')}">${text}</span>`;
        });

        return `<span class="${HIGHLIGHT_CLASS_PREFIX}line">${spans.join('')}</span>`;
      });

      return codeBlockHtml(lines.join('\n'), language);
    },
  };
}
