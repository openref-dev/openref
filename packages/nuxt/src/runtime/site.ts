/**
 * The served half of SPEC 16.4, built once per server process.
 *
 * THE SAME SITE THE BUILD WRITES, ASKED INSTEAD OF READ. `createSiteServer` in `@openref/static`
 * produces every artefact through the same functions `buildSite` writes them with, so a page
 * served here and the same page generated into the public directory are the same bytes, the
 * response nonce excepted. Nothing about the reference is spelled again in this package.
 *
 * BUILT ONCE AND NOT PER REQUEST. Normalizing the document, resolving the assets and building the
 * highlighter are functions of the specification and of nothing about a request, so they happen
 * on the first request and are kept; the SPEC 12 cache, keyed by document hash, is what makes the
 * second request for a page free.
 *
 * THE HIGHLIGHTER IS BUILT HERE FOR THE SAME REASON THE BUILD BUILDS ONE. A served page that
 * differed from the generated page by its highlighted code would be two references from one
 * document, which is exactly what SPEC 16.4 exists to refuse. It fails open to the plain
 * highlighter, which is the policy `renderStaticSite` states.
 */

import {
  createMarkdownRenderer,
  createMemoryRenderCache,
  type IRenderCache,
} from '@openref/render';
import {
  createSiteServer,
  highlighterFor,
  type BuildTarget,
  type ISiteServer,
} from '@openref/static';
import { documentOf } from '../document/application/services/load-specification.service';

/** What the module embeds into the server build for the runtime to read. */
export interface EmbeddedSite {
  /** The specification file, verbatim. */
  readonly specification: string;
  /** Where it was read from, for a parse failure's message. */
  readonly source: string;
  /** The mount, as `resolveSiteBase` takes it. */
  readonly base: string;
  /** The proxy target of SPEC 16.2, or null when none was given. */
  readonly target: BuildTarget | null;
  /** SPEC 16.2's `forwardCookies`. */
  readonly forwardCookies: boolean;
  /** Value of the `lang` attribute on every page. */
  readonly lang: string | null;
  /** Forced colour scheme, or null to follow the reader's system preference. */
  readonly colorScheme: 'light' | 'dark' | null;
  /**
   * The names of the files a page links, resolved at build time.
   *
   * NAMES AND NOT BYTES, per `SiteAssetNames`. The deployment publishes the assets from its own
   * static layer, which the module registered from the same catalogue these names come from, so
   * the served page links exactly what the generated page links and this server keeps no fonts
   * in memory. It also removes the one thing a bundled server cannot do: `@openref/nest/browser`
   * is resolved from a module url, and inside a Nitro chunk there is no module url to resolve
   * from. Measured before it was designed around: the first served build answered 500 with
   * `"@openref/nest/browser" could not be resolved`.
   */
  readonly assets: {
    readonly servedNames: Readonly<Record<string, string>>;
    readonly stylesheetNames: readonly string[];
    readonly moduleName: string;
  };
}

/**
 * A site built on the first request and kept.
 *
 * ONE PER HANDLER RATHER THAN ONE PER PROCESS, which is a correctness point and not a style one:
 * a Nuxt application may mount two references at two bases, and a module level singleton would
 * hand the second mount the first mount's document. The memoization is the closure.
 *
 * THE CACHE IS A PARAMETER SO THAT ITS CONSULTATION CAN BE OBSERVED, and that is a hole this
 * seam had. The SPEC 12 cache was constructed inline, so deleting the line left every case in
 * this package green and only the unused import said anything: the third build clause of `T061`,
 * "SSR under Nuxt using the same hash keyed cache", had no runner at all. `runtime-site.spec.ts`
 * now hands in an observable cache and asserts a hit on the second request for one address, and
 * deleting the option below turns that case red.
 *
 * @param embedded - What the module put into the build
 * @param cache - The SPEC 12 cache, keyed by document hash. A bounded memory one by default,
 *   which is what a server process wants; a caller supplies its own to watch it.
 * @returns A function returning the site, building it once
 */
export function createSite(
  embedded: EmbeddedSite,
  cache: IRenderCache = createMemoryRenderCache(),
): () => Promise<ISiteServer> {
  let pending: Promise<ISiteServer> | null = null;

  return () => {
    pending ??= build(embedded, cache);

    return pending;
  };
}

/**
 * Builds the site server.
 *
 * @param embedded - What the module put into the build
 * @param cache - The SPEC 12 cache the pages go through
 * @returns The site server
 */
async function build(embedded: EmbeddedSite, cache: IRenderCache): Promise<ISiteServer> {
  const highlighter = await highlighterFor((message) => {
    process.stderr.write(message);
  });

  return createSiteServer({
    document: documentOf(embedded.specification, embedded.source),
    assets: embedded.assets,
    base: embedded.base,
    highlighter,
    markdown: await createMarkdownRenderer({ highlighter }),
    cache,
    ...(embedded.lang === null ? {} : { lang: embedded.lang }),
    ...(embedded.colorScheme === null ? {} : { colorScheme: embedded.colorScheme }),
    ...(embedded.target === null
      ? {}
      : { proxy: { target: embedded.target, forwardCookies: embedded.forwardCookies } }),
  });
}
