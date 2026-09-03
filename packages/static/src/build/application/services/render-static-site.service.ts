/**
 * The wiring one static build needs, in one place.
 *
 * IT IS SHARED BECAUSE THREE CALLERS DO THE SAME BUILD. `openref build` does it because that is
 * its whole job, `openref pr` does it to produce the pull request preview of SPEC 17.2, and since
 * `T061` the Nuxt module does it during `nuxt generate`. A second copy of the highlighter, the
 * markdown renderer and the asset resolution would be builds that agree until the day one of them
 * is changed, and the artefact a reader opens is the same artefact.
 *
 * IT MOVED HERE FROM `packages/cli` AT `T061`, AND THE MOVE IS THE REASON RATHER THAN A TIDY UP.
 * The Nuxt module may not depend on the CLI: a Nuxt application has no business installing a
 * rewriter for TypeScript sources. What both callers need is the static build, which is this
 * package, so the wiring lives at the floor both of them can reach, the same rule
 * `package-assets.adapter.ts` follows for the client bundle specifier.
 *
 * THE GENERATED SAMPLES OF SPEC 18 ARE COMPOSED IN THIS PACKAGE SINCE `TX-PAGE-SAMPLES`, and one
 * level below this file: `buildSite` and `createSiteServer` each apply the transform, because they
 * are the two entry points into page rendering and `served-equals-built.spec.ts` compares exactly
 * those two. Applying it here instead left the served side transformed and the built side not, and
 * thirteen files differed. `openref build` composed them and `nuxt generate` did not before that,
 * which is what moved them into this package at all: measured, two cases of
 * `packages/nuxt/test/integration/nuxt-parity.spec.ts`, the committed claims that one tree built
 * twice is one tree.
 *
 * THE ANCHOR IS THE CALLER'S AND THAT IS DELIBERATE. `@openref/nest/browser` is the default client
 * bundle and is a dependency of the callers rather than of this package, so `resolveFrom` carries
 * the module url of whoever asked for the build. `resolveAssetPath` states the same rule where it
 * declares its third anchor.
 */

import type { IRDocument } from '@openref/core';
import {
  createMarkdownRenderer,
  createOpenRefHighlighter,
  loadDefaultAssets,
  plainHighlighter,
  type IHighlighter,
} from '@openref/render';
import type { IOutputStore } from '../ports/output-store.port';
import type { BuildTarget } from '../../../proxy/domain/proxy-target';
import { buildSite, type BuildReport } from './build-site.service';

/** One build, as a caller asks for it. */
export interface StaticBuildRequest {
  /** The normalized document. */
  readonly document: IRDocument;
  /** Where the site is written. */
  readonly store: IOutputStore;
  /** Module url of the caller, from which the default client bundle is resolved. */
  readonly resolveFrom: string;
  /** `/docs`, or an absolute url; absent means the root. */
  readonly base?: string | undefined;
  /** The proxy target of SPEC 16.2; absent means no proxy is generated at all. */
  readonly target?: BuildTarget | undefined;
  /** SPEC 16.2's `forwardCookies`. False unless explicitly turned on. */
  readonly forwardCookies?: boolean | undefined;
  /** Where a degradation notice goes. */
  readonly onNotice: (message: string) => void;
}

/**
 * Renders a document to an output store.
 *
 * @param request - What to build and where
 * @returns What the build did
 * @throws {InvalidOptionsError} When the base is neither a path nor an http url
 */
export async function renderStaticSite(request: StaticBuildRequest): Promise<BuildReport> {
  const highlighter = await highlighterFor(request.onNotice);
  const markdown = await createMarkdownRenderer({ highlighter });

  return buildSite({
    document: request.document,
    store: request.store,
    assets: loadDefaultAssets({ resolveFrom: request.resolveFrom }),
    ...(request.base === undefined ? {} : { base: request.base }),
    ...(request.target === undefined
      ? {}
      : {
          proxy: {
            target: request.target,
            ...(request.forwardCookies === undefined
              ? {}
              : { forwardCookies: request.forwardCookies }),
          },
        }),
    highlighter,
    markdown,
  });
}

/**
 * The highlighter, or the plain one when it could not be built.
 *
 * FAIL OPEN, the same policy `ReferenceService` states for the same component: highlighting is
 * presentation, so losing it costs colour while refusing to build costs the documentation. The
 * degradation is named rather than swallowed.
 *
 * @param onNotice - Where the notice goes
 * @returns The highlighter
 */
export async function highlighterFor(onNotice: (message: string) => void): Promise<IHighlighter> {
  try {
    return await createOpenRefHighlighter();
  } catch (cause) {
    onNotice(
      `openref: the syntax highlighter could not be built, so code blocks are plain: ${
        cause instanceof Error ? cause.message : String(cause)
      }\n`,
    );
    return plainHighlighter;
  }
}
