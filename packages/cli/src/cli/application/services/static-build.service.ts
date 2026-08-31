import { FsOutputStore, renderStaticSite as renderSite, type BuildReport } from '@openref/static';
import type { BuildTarget } from '@openref/static';
import type { IRDocument } from '@openref/core';
import type { CommandIo } from '../../domain/command.types';

/**
 * The CLI's half of one static build: a directory, an anchor and where a notice goes.
 *
 * THE WIRING ITSELF MOVED TO `@openref/static` AT `T061` and this is what stayed behind. Three
 * callers now do the same build, and the third is the Nuxt module, which may not depend on the
 * CLI; the wiring therefore lives at the floor both can reach and its own header says why. What
 * cannot move is the anchor: `@openref/nest/browser` is a dependency of THIS package, so
 * `resolveFrom` has to be this module's url, per `resolveAssetPath`'s third anchor.
 */

/** One build, as a command asks for it. */
export interface StaticBuildRequest {
  readonly document: IRDocument;
  /** Where the site is written. */
  readonly out: string;
  /** `/docs`, or an absolute url; absent means the root. */
  readonly base?: string | undefined;
  /** The proxy target of SPEC 16.2; absent means no proxy is generated at all. */
  readonly target?: BuildTarget | undefined;
  /** Where a degradation notice goes. */
  readonly io: CommandIo;
}

/**
 * Renders a document to a directory.
 *
 * @param request - What to build and where
 * @returns What the build did
 * @throws {InvalidOptionsError} When the base is neither a path nor an http url
 */
export async function renderStaticSite(request: StaticBuildRequest): Promise<BuildReport> {
  return renderSite({
    document: request.document,
    store: new FsOutputStore(request.out),
    // RESOLVED FROM THIS MODULE, per `resolveAssetPath`'s third anchor. The default client
    // bundle is `@openref/nest/browser`, which is a dependency of this package and not of
    // `@openref/render`, where the resolver lives; anchoring here is what makes the string a
    // string rather than an edge on the other side of the boundary.
    resolveFrom: import.meta.url,
    base: request.base,
    target: request.target,
    onNotice: (message) => {
      request.io.stderr(message);
    },
  });
}
