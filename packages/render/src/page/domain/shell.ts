/**
 * The document around the application: head, assets, state, mount point.
 *
 * This runs on the way out of the cache, not on the way in. A nonce is per response and
 * belongs to nothing that is cached: stored, it would either be handed to a second
 * response, which is what a nonce exists to prevent, or be stale, which breaks every
 * script and style on the page. So the cache holds markup with no nonce in it and the
 * shell puts one in each time.
 *
 * Every asset is external, per SPEC 19.2. The only element with content in it is the
 * state block, which is data rather than code and still carries the nonce.
 */

import { compareByCodePoint, ErrorCode, InvalidOptionsError } from '@openref/core';
import type { RenderedPage } from '../../cache/application/ports/render-cache.port';
import { APP_ROOT_ID } from '../../components/ReferenceApp';
import { escapeHtml, escapeJsonForScript } from '../../shared/html';

/** Id of the element holding the serialized page model. */
export const STATE_ELEMENT_ID = 'oref-state';

/**
 * Characters a nonce may consist of.
 *
 * The CSP grammar says base64, and this is that set. It is checked rather than escaped
 * because a nonce that needed escaping is not a nonce, it is an injection attempt or a
 * bug in whatever generated it, and both deserve to stop the response.
 */
const NONCE_PATTERN = /^[A-Za-z0-9+/=_-]{8,256}$/;

/** External assets the page loads. */
export interface ShellAssets {
  /** Stylesheet urls, loaded with `link rel=stylesheet`. */
  readonly stylesheets?: readonly string[];
  /** Module urls, loaded with `script type=module src=...`. */
  readonly modules?: readonly string[];
}

/** How the shell is assembled for one response. */
export interface ShellOptions {
  /**
   * CSP nonce for this response.
   *
   * Absent leaves the nonce attributes empty, which is correct only when the host serves
   * no `script-src` nonce policy. A static build is the case that has no nonce to give:
   * files on disk are one response reused, and a nonce that is reused is not a nonce.
   */
  readonly nonce?: string;
  readonly assets?: ShellAssets;
  /** Value of the `lang` attribute. */
  readonly lang?: string;
  /** Forces a colour scheme through `data-oref-color-scheme` instead of the system one. */
  readonly colorScheme?: 'light' | 'dark';
  /**
   * Design token values of the theme in force, per SPEC 10.4's L0 surface. Consumed since T033.
   *
   * Written as one `style` element carrying `:root` declarations, under the response nonce,
   * which is the one inline form a strict CSP can authorize. It comes after the stylesheet
   * links, so a value stated here wins the cascade against the theme's own file, which is what
   * a default that is also an override has to do. The boundary is the field's, stated in
   * `@openref/vue`: one flat record, no cascade and no media query in it, so a theme that
   * needs two colour modes ships a stylesheet and leaves this empty.
   */
  readonly tokens?: Readonly<Record<string, string>>;
}

/**
 * Checks a nonce before it reaches an attribute.
 *
 * @param nonce - Nonce as the host generated it
 * @returns The same nonce
 * @throws InvalidOptionsError when it is not a plausible nonce
 */
export function assertNonce(nonce: string): string {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new InvalidOptionsError(
      'CSP nonce must be 8 to 256 base64 characters; refusing to write it into the document',
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { length: nonce.length },
    );
  }

  return nonce;
}

/**
 * Value for the nonce attribute, which is always written.
 *
 * Always, including when the host serves no nonce policy, and then it is empty. Two
 * reasons, and the second is the load bearing one. An empty nonce authorizes nothing, so
 * it costs nothing where there is no policy. And every script element this package can
 * emit then carries the attribute in the source, which is what the CSP gate reads: a
 * conditional attribute would leave a script tag with no `nonce=` in the built file, and
 * the gate cannot tell that apart from a script that genuinely forgot one. For the same
 * reason the attribute is written in the template literal rather than returned from here
 * whole: a scan reads the text of the tag, not the value of a call.
 *
 * @param nonce - Nonce for this response, or undefined
 * @returns The attribute, with an empty value when there is no nonce
 */
function nonceValue(nonce: string | undefined): string {
  return nonce === undefined ? '' : assertNonce(nonce);
}

/** Token names are `--oref-{group}-{name}`, the same shape `@openref/vue` validates. */
const TOKEN_NAME = /^--oref-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * What a token value may hold on its way into a style element.
 *
 * AN INJECTION GUARD AND NOT THE CONTRACT CHECK. `resolveTheme` validated the theme where it
 * was resolved; this refuses the characters that would let a value close the element or open
 * a block, because a style element cannot be escaped the way text can, only refused. Newlines
 * are out with them: no CSS value this surface is for needs one, and a value that brings one
 * is bringing structure, not style.
 *
 * THE SEMICOLON JOINED THEM AT T035. The guard was written against a value escaping `:root{…}`
 * and a semicolon does not do that, which is why it was let through; what it does instead is end
 * the declaration it was given and begin one nobody authorized, so `red;position:fixed;top:0`
 * writes three declarations onto the root element from inside the nonce carrying element the
 * strict CSP of SPEC 19.2 exists to make trustworthy. No token value on this surface needs one:
 * a value is one declaration's worth of CSS, and a font stack separates with commas.
 */
const TOKEN_VALUE = /^[^<>{};\r\n]*$/;

/**
 * The theme's token values as one nonce carrying style element, or nothing.
 *
 * Sorted by code point, so the same record always produces the same bytes whatever order a
 * host wrote it in, which is the same rule every other ordering in the document follows.
 *
 * @param tokens - Token values, possibly absent or empty
 * @param nonce - Nonce for this response, or undefined
 * @returns The element, or an empty string when there is nothing to declare
 * @throws InvalidOptionsError when a name or a value could not be written safely
 */
function tokenStyleElement(
  tokens: Readonly<Record<string, string>> | undefined,
  nonce: string | undefined,
): string {
  const names = Object.keys(tokens ?? {}).sort(compareByCodePoint);
  if (tokens === undefined || names.length === 0) return '';

  const declarations = names
    .map((name) => {
      const value = tokens[name] ?? '';

      if (!TOKEN_NAME.test(name)) {
        throw new InvalidOptionsError(
          `theme token "${name}" is not of the form --oref-{group}-{name}; refusing to write it into the document`,
          ErrorCode.CONFIG_INVALID_OPTIONS,
          undefined,
          { token: name },
        );
      }

      if (!TOKEN_VALUE.test(value)) {
        throw new InvalidOptionsError(
          `theme token "${name}" carries a value that cannot be written into a style element; refusing rather than escaping`,
          ErrorCode.CONFIG_INVALID_OPTIONS,
          undefined,
          { token: name },
        );
      }

      return `${name}:${value}`;
    })
    .join(';');

  return `<style nonce="${nonceValue(nonce)}">:root{${declarations}}</style>`;
}

/**
 * Assembles the full HTML document for one response.
 *
 * @param page - Page as it came out of the render cache
 * @param options - Nonce, assets and document level attributes for this response
 * @returns A complete HTML document
 */
export function renderHtmlDocument(page: RenderedPage, options: ShellOptions = {}): string {
  const nonce = options.nonce;
  const assets = options.assets ?? {};
  const lang = options.lang ?? 'en';
  const scheme =
    options.colorScheme === undefined
      ? ''
      : ` data-oref-color-scheme="${escapeHtml(options.colorScheme)}"`;

  const stylesheets = (assets.stylesheets ?? [])
    .map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`)
    .join('');

  const tokens = tokenStyleElement(options.tokens, nonce);

  const modules = (assets.modules ?? [])
    .map(
      (src) =>
        `<script type="module" src="${escapeHtml(src)}" nonce="${nonceValue(nonce)}"></script>`,
    )
    .join('');

  const state =
    `<script type="application/json" id="${STATE_ELEMENT_ID}" nonce="${nonceValue(nonce)}">` +
    `${escapeJsonForScript(page.stateJson)}</script>`;

  return (
    '<!DOCTYPE html>' +
    `<html lang="${escapeHtml(lang)}"${scheme}>` +
    '<head>' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${escapeHtml(page.title)}</title>` +
    stylesheets +
    tokens +
    '</head>' +
    '<body class="oref-body">' +
    `<div id="${APP_ROOT_ID}">${page.appHtml}</div>` +
    state +
    modules +
    '</body>' +
    '</html>'
  );
}
