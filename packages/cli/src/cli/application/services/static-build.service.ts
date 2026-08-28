import {
  createMarkdownRenderer,
  createOpenRefHighlighter,
  loadDefaultAssets,
  plainHighlighter,
  type IHighlighter,
} from '@openref/render';
import { buildSite, FsOutputStore, type BuildReport, type BuildTarget } from '@openref/static';
import type { IRDocument } from '@openref/core';
import type { CommandIo } from '../../domain/command.types';

/**
 * The wiring one static build needs, in one place.
 *
 * IT IS SHARED BECAUSE TWO COMMANDS DO THE SAME BUILD. `build` does it because that is its whole
 * job, and `pr` does it to produce the pull request preview of SPEC 17.2. A second copy of the
 * highlighter, the markdown renderer and the asset resolution would be two builds that agree
 * until the day one of them is changed, and the artefact a reader opens is the same artefact.
 */

/** One build, as a caller asks for it. */
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
  const highlighter = await highlighterFor(request.io);
  const markdown = await createMarkdownRenderer({ highlighter });

  return buildSite({
    document: request.document,
    store: new FsOutputStore(request.out),
    // RESOLVED FROM THIS MODULE, per `resolveAssetPath`'s third anchor. The default client
    // bundle is `@openref/nest/browser`, which is a dependency of this package and not of
    // `@openref/render`, where the resolver lives; anchoring here is what makes the string a
    // string rather than an edge on the other side of the boundary.
    assets: loadDefaultAssets({ resolveFrom: import.meta.url }),
    ...(request.base === undefined ? {} : { base: request.base }),
    ...(request.target === undefined ? {} : { proxy: { target: request.target } }),
    highlighter,
    markdown,
  });
}

/**
 * The highlighter, or the plain one when it could not be built.
 *
 * FAIL OPEN, the same policy `ReferenceService` states for the same component: highlighting is
 * presentation, so losing it costs colour while refusing to build costs the documentation. The
 * degradation is named on stderr rather than swallowed.
 *
 * @param io - Where the notice goes
 * @returns The highlighter
 */
export async function highlighterFor(io: CommandIo): Promise<IHighlighter> {
  try {
    return await createOpenRefHighlighter();
  } catch (cause) {
    io.stderr(
      `openref: the syntax highlighter could not be built, so code blocks are plain: ${
        cause instanceof Error ? cause.message : String(cause)
      }\n`,
    );
    return plainHighlighter;
  }
}
