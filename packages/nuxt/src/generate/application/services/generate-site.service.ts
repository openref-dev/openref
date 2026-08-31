/**
 * The static generation half of SPEC 16.4: `nuxt generate` writes what `openref build` writes.
 *
 * IT CALLS THE CLI'S OWN BUILD AND NOT A COPY OF IT. `renderStaticSite` in `@openref/static` is
 * the wiring both entry points share, so the highlighter, the markdown renderer, the resolved
 * assets and every byte of every page come from one place. That is what makes the equality suite
 * a check rather than a coincidence: there is no second implementation for the two to drift
 * apart from, and the suite exists to catch the day somebody adds one.
 *
 * WHERE IT WRITES. Into `<publicDir><base>`, because a Nuxt deployment publishes `publicDir` at
 * the site root and the reference is mounted under `base`. The relative paths inside that
 * directory are exactly the ones `openref build --out` produces, which is what the two trees are
 * compared on.
 */

import {
  BUILD_MANIFEST_FILE,
  FsOutputStore,
  readManifest,
  renderStaticSite,
} from '@openref/static';
import type { BuildReport } from '@openref/static';
import { join } from 'node:path';
import {
  documentOf,
  type LoadedSpecification,
} from '../../../document/application/services/load-specification.service';
import { PublicDirStore } from '../../infrastructure/adapters/public-dir-store.adapter';
import { nitroProxyFile } from '../../../proxy/domain/nitro-proxy-route';
import type { ResolvedNuxtOptions } from '../../../module/domain/module-options';

/** What one generation did. */
export interface GenerateReport {
  /** What the static build reported. */
  readonly build: BuildReport;
  /** Directory the reference was written into. */
  readonly directory: string;
  /**
   * The Nitro proxy source the build produced and this generation did not publish.
   *
   * Null when no target was given or the target is not `nitro`. Held back rather than written,
   * because server source in a public directory is source a reader can fetch; the module
   * registers these same bytes as a route.
   */
  readonly withheldProxySource: string | null;
}

/**
 * The path under the public directory the reference is written to.
 *
 * @param basePath - The resolved mount, with a leading slash
 * @returns The path relative to the public directory, with no leading slash
 */
export function mountDirectoryOf(basePath: string): string {
  return basePath.replace(/^\//, '');
}

/**
 * Writes the reference into a Nuxt public directory.
 *
 * @param options - The resolved module options
 * @param specification - The document, already read
 * @param publicDir - Absolute path of the Nuxt public directory
 * @param onNotice - Where a degradation notice goes
 * @returns What the build did and what it withheld
 */
export async function generateSite(
  options: ResolvedNuxtOptions,
  specification: LoadedSpecification,
  publicDir: string,
  onNotice: (message: string) => void,
): Promise<GenerateReport> {
  const mount = mountDirectoryOf(options.basePath);
  const directory = join(publicDir, mount);

  const store = new PublicDirStore({
    root: publicDir,
    mount,
    ownedFiles: await previousFiles(directory),
    withheldFile: options.target === 'nitro' ? nitroProxyFile(options.basePath) : null,
  });

  const build = await renderStaticSite({
    document: documentOf(specification.text, specification.path),
    store,
    // THE ANCHOR IS THIS PACKAGE, per `resolveAssetPath`'s third anchor: `@openref/nest/browser`
    // is the default client bundle and is a dependency of this package rather than of the
    // renderer, which is where the resolver lives.
    resolveFrom: import.meta.url,
    base: options.base,
    target: options.target,
    forwardCookies: options.forwardCookies,
    onNotice,
  });

  return { build, directory, withheldProxySource: store.withheld };
}

/**
 * The files the previous build of this reference wrote, from its own manifest.
 *
 * THEY ARE THE ONES THIS BUILD MAY OVERWRITE, and everything else in the directory belongs to
 * somebody else. A directory with no manifest yields the manifest's own name and nothing more:
 * a file called `.openref-build-manifest.json` inside the reference's own mount is this build's
 * whatever state it is in, and refusing to replace an unreadable one would refuse the rebuild
 * that fixes it.
 *
 * @param directory - Where the reference is written
 * @returns Paths relative to that directory
 */
async function previousFiles(directory: string): Promise<readonly string[]> {
  const text = await new FsOutputStore(directory).read(BUILD_MANIFEST_FILE);
  const manifest = text === null ? null : readManifest(text);

  if (manifest === null) return [BUILD_MANIFEST_FILE];

  return [BUILD_MANIFEST_FILE, ...manifest.pages.map((page) => page.file), ...manifest.files];
}
