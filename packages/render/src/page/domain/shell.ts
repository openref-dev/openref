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
 * state block, which is data rather than code and carries the nonce whenever one exists.
 */

import { compareByCodePoint, ErrorCode, InvalidOptionsError } from '@openref/core';
import type { RenderedPage } from '../../cache/application/ports/render-cache.port';
import { APP_ROOT_ID } from '../../components/ReferenceApp';
import { escapeHtml, escapeJsonForScript } from '../../shared/html';

/** Id of the element holding the serialized page model. */
export const STATE_ELEMENT_ID = 'oref-state';

/**
 * Builds the policy of SPEC 19.2, for a host to set. This module sets no header.
 *
 * THE NAME IS A VERB SINCE T064, AND THE RENAME IS THE WHOLE POINT OF THE ENTRY. It was
 * `contentSecurityPolicy`, a bare noun, and in an export list a bare noun for a policy reads as
 * "the policy this module applies". It applies none: nothing in this package, in `@openref/nest`
 * or in `@openref/nuxt` writes a `Content-Security-Policy` header, deliberately, because a header
 * written by a module the host did not ask for a policy from is either too narrow for the host's
 * own pages or too wide to be worth writing. The reference makes its output compatible with this
 * policy; the host decides whether to serve it. The rename happened at T064 rather than being
 * noted, because T064 is the task that decided which packages go out, and a name is frozen from
 * the day the package carrying it is published.
 *
 * WHERE A HOST REACHES IT, STATED AFTER THE REVERSAL RATHER THAN BEFORE IT. The reason above was
 * first written as "T064 publishes `@openref/nuxt`", and T064 reversed that decision in the same
 * session: `@openref/nuxt` stays private, because its peer dependency lands in the licence policy's
 * zone 1. So a Nest host reaches this through `@openref/nest`, which re-exports it, and a Nuxt host
 * has no package to reach it from and transcribes the policy for now. The guide says exactly that,
 * and `published-consumer.spec.ts` holds every package the guide names against what a consumer can
 * install, so the sentence cannot go back to naming one they cannot.
 *
 * WHAT A CALLER RECEIVES IS A STRING, AND WHAT THEY DO WITH IT IS THEIRS. A host that serves no
 * policy calls nothing here and gets a page with no nonce attribute, which is the same page the
 * static build writes.
 *
 * `default-src 'none'` rather than `'self'`, because the claim SPEC 19.2 makes is about what the
 * page needs rather than about what it happens to get away with. Every directive below it is one
 * this reference actually uses, and anything that appears later has to be added here deliberately
 * instead of arriving under a permissive default.
 *
 * NO `unsafe-inline` AND NO `unsafe-eval` IN EITHER OF THE TWO DIRECTIVES THAT MATTER. That is the
 * whole competitive claim.
 *
 * IT LIVES HERE SINCE `T061`, MOVED FROM THE BROWSER FIXTURE, and the move is the standing rule
 * about a vocabulary spoken by more than one surface. Three surfaces now say this policy: the
 * fixture a browser enforces it in, the Nuxt example that serves the reference under it, and the
 * suite that compares the served header with it. Three spellings of one policy is a reference
 * proved under a weaker rule than the one it claims, so there is one spelling, next to
 * `assertNonce` and to the shell whose elements the nonce is written onto. A host writing its own
 * policy calls this and adds what its own pages need.
 *
 * @param nonce - The nonce generated for this response
 * @param connect - Extra `connect-src` origins. `connect-src` IS THE ONE DIRECTIVE A HOST HAS TO
 *   WIDEN, and T035 is where that stopped being a note: the token exchange of the authorization
 *   code flow is a browser `fetch` to the authorization server, so a reference under
 *   `connect-src 'self'` cannot sign in at all. Passed in rather than defaulted, so a case can be
 *   run both ways.
 * @returns The header value
 */
export function buildContentSecurityPolicy(nonce: string, connect: readonly string[] = []): string {
  return [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "font-src 'self'",
    "img-src 'self' data:",
    ['connect-src', "'self'", ...connect].join(' '),
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

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

/**
 * What the static build of SPEC 16.1 adds to the head, per page.
 *
 * COMPOSED BY THE CALLER AND WRITTEN HERE, because the shell owns the head and string surgery
 * on an assembled document is the class of edit nothing can verify. The one script among them,
 * JSON-LD, is data the way the state block is data: it is never executed, it carries the nonce
 * the way every script element from this file does when there is one, and its content is
 * escaped by the same rule, so `</script>` cannot appear inside it.
 */
export interface ShellHead {
  /** Absolute url of the canonical page, written as `link rel=canonical`. */
  readonly canonicalUrl?: string;
  /** Plain text summary, written as `meta name=description`. */
  readonly description?: string;
  /** OpenGraph properties, written in the given order as `meta property=... content=...`. */
  readonly openGraph?: readonly { readonly property: string; readonly content: string }[];
  /** JSON-LD, already serialized. Written as one `script type=application/ld+json`. */
  readonly jsonLd?: string;
}

/** How the shell is assembled for one response. */
export interface ShellOptions {
  /**
   * CSP nonce for this response.
   *
   * Absent writes no nonce attribute at all, which is correct only when the host serves
   * no `script-src` nonce policy. A static build is the case that has no nonce to give:
   * files on disk are one response reused, and a nonce that is reused is not a nonce.
   */
  readonly nonce?: string;
  readonly assets?: ShellAssets;
  /** Head additions of the static build, absent on a served page. */
  readonly head?: ShellHead;
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

/*
 * THE NONCE ATTRIBUTE IS WRITTEN EXACTLY WHEN THERE IS A NONCE TO WRITE. A served response
 * carries the per response nonce it was given; a static build has none to give, and an empty
 * `nonce=""` is not a smaller version of one: it authorizes nothing under any policy, so on a
 * file on disk it was decoration that read as machinery. The conditional is spelled inline in
 * each element's template rather than returned whole from a helper, deliberately: the CSP gate
 * scans built output as text and requires `nonce=` inside the open tag of every contentful
 * script and style element, and an attribute that arrives from a call would leave a tag the
 * scan cannot tell from one that genuinely forgot its nonce. The inline spelling keeps the
 * machinery in the tag's own text, in the source and in the built file, which is what the
 * scan reads.
 */

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

  return `<style${nonce === undefined ? '' : ` nonce="${assertNonce(nonce)}"`}>:root{${declarations}}</style>`;
}

/**
 * The head additions of one page, or nothing.
 *
 * Every value is escaped on the way into an attribute; the JSON-LD content is escaped by
 * {@link escapeJsonForScript}, the state block's own rule, so a `<` can never open an element
 * inside it and `</script>` cannot appear. The element order is fixed: description, canonical,
 * OpenGraph, JSON-LD, so the same inputs always produce the same bytes.
 *
 * @param head - What the caller composed, possibly absent
 * @param nonce - Nonce for this response, or undefined
 * @returns The elements, or an empty string
 */
function headElements(head: ShellHead | undefined, nonce: string | undefined): string {
  if (head === undefined) return '';

  const description =
    head.description === undefined
      ? ''
      : `<meta name="description" content="${escapeHtml(head.description)}">`;

  const canonical =
    head.canonicalUrl === undefined
      ? ''
      : `<link rel="canonical" href="${escapeHtml(head.canonicalUrl)}">`;

  const openGraph = (head.openGraph ?? [])
    .map(
      (tag) => `<meta property="${escapeHtml(tag.property)}" content="${escapeHtml(tag.content)}">`,
    )
    .join('');

  const jsonLd =
    head.jsonLd === undefined
      ? ''
      : `<script type="application/ld+json"${nonce === undefined ? '' : ` nonce="${assertNonce(nonce)}"`}>` +
        `${escapeJsonForScript(head.jsonLd)}</script>`;

  return description + canonical + openGraph + jsonLd;
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

  const head = headElements(options.head, nonce);

  const tokens = tokenStyleElement(options.tokens, nonce);

  const modules = (assets.modules ?? [])
    .map(
      (src) =>
        `<script type="module" src="${escapeHtml(src)}"${nonce === undefined ? '' : ` nonce="${assertNonce(nonce)}"`}></script>`,
    )
    .join('');

  const state =
    `<script type="application/json" id="${STATE_ELEMENT_ID}"${nonce === undefined ? '' : ` nonce="${assertNonce(nonce)}"`}>` +
    `${escapeJsonForScript(page.stateJson)}</script>`;

  return (
    '<!DOCTYPE html>' +
    `<html lang="${escapeHtml(lang)}"${scheme}>` +
    '<head>' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${escapeHtml(page.title)}</title>` +
    head +
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
