/**
 * The artefacts as a reader receives them, rather than as `pnpm build` leaves them.
 *
 * WHY THIS EXISTS. Every size budget in this repository weighed a file on disk under a package's
 * own `dist`, and nothing ships that file. Both surfaces that publish a reference, the
 * static build of `T039` and the server of `@openref/nest`, hand every asset to the renderer's
 * catalog first: it names each file after the digest of its own bytes and rewrites every sibling
 * reference inside a stylesheet or a module onto those names, so what a browser downloads is
 * longer than what the bundler wrote. Measured 2026-08-30 and ruled on 2026-08-31: the default
 * theme's stylesheets are 62,594 bytes published against 62,424 on disk, and the first paint's six
 * files are 110,539 against 110,284. SPEC 20 records the itemised difference; SPEC 0 records the
 * class, a check measuring the wrong quantity.
 *
 * IT CALLS THE SHIPPED CATALOG RATHER THAN DESCRIBING IT. The growth looks like arithmetic, one
 * reference costing a dot and sixteen digest characters, and writing that arithmetic here would be
 * a second copy of a rule that already has one owner. The copy would also be wrong in a case that
 * exists: a `url()` written without a leading `./` gains the two characters as well, so the
 * per reference cost is not a constant. What this module does is load `@openref/render` and ask
 * it, which makes a divergence between the gate and the publishers impossible by construction.
 *
 * IT IS LOADED LAZILY AND FAILS LOUDLY. The import is a runtime `require` rather than a static
 * one, so a tree with nothing built still prints its skips instead of failing to start; and when
 * a published form budget does have files to weigh and the catalog cannot be reached, the budget
 * reports an error rather than quietly falling back to the form nobody downloads, which is the
 * exact substitution the move away from that form was about.
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { AssetCatalog, AssetPlan, AssetSource, DefaultAssetOptions } from '@openref/render';
import { CLIENT_JS_ENTRY, THEME_CSS_ROOTS } from '../config.js';
import { collectFiles } from './walk.js';

/**
 * The part of `@openref/render` this needs, named so nothing here handles an `any`.
 *
 * The types are imported with `import type`, which erases at compile time, so declaring this
 * interface costs no edge in the built bundle: the only runtime reference to the package is the
 * `require` below.
 */
interface RenderAssetApi {
  loadDefaultAssets: (options?: DefaultAssetOptions) => AssetPlan;
  buildAssetCatalog: (sources: readonly AssetSource[]) => AssetCatalog;
}

/**
 * The published bytes of every asset a served reference is made of, by disk file name.
 *
 * The key is the name the file has on disk, which is what a budget's file walk finds and what a
 * stylesheet or a module refers to it by. The served name, which carries the digest, is not a key
 * here: nothing weighs a file by the name it is requested under.
 *
 * THE BYTES AND NOT THEIR COUNT, so that both quantities a budget can name come from one form.
 * Returning a length would leave a caller measuring the raw size of what ships and the gzip size
 * of what does not, which is one artefact reported as two.
 */
export type PublishedForm = ReadonlyMap<string, Uint8Array>;

/** Cached per repository root, because six budgets ask the same question of one build. */
const cache = new Map<string, PublishedForm>();

/**
 * Reads every asset a served reference is made of and returns its published size.
 *
 * @param repoRoot - Absolute repository root
 * @returns Published bytes by disk file name
 * @throws Error when the renderer or the built artefacts cannot be reached, naming which
 */
export function readPublishedForm(repoRoot: string): PublishedForm {
  const cached = cache.get(repoRoot);
  if (cached !== undefined) return cached;

  // THE FILES ARE NAMED BY PATH UNDER `repoRoot` RATHER THAN BY PACKAGE SPECIFIER, and that is not
  // a style choice. `resolveAssetPath` tries the caller's anchor, then this package's, then the
  // host application's, so a specifier can resolve outside the tree it was asked about: measured
  // 2026-08-31 on a directory holding no build at all, where the plan resolved and returned a
  // catalog of somebody else's artefacts. A `repoRoot` parameter that the answer does not depend
  // on is a parameter that lies, and the budgets weigh paths anyway. The two names come from the
  // budget configuration itself, so the catalog holds exactly the stylesheets `theme-css-raw`
  // walks and the entry `client-js-raw` partitions from.
  const stylesheets = THEME_CSS_ROOTS.flatMap((root) =>
    collectFiles(join(repoRoot, root), ['.css'], repoRoot),
  ).map((relativePath) => join(repoRoot, relativePath));

  if (stylesheets.length === 0) {
    throw new Error(
      `no stylesheet was found under ${THEME_CSS_ROOTS.join(', ')} of ${repoRoot}, so a served ` +
        'reference cannot be assembled and nothing here would describe what a reader downloads',
    );
  }

  // THE MODULE IS RESOLVED FROM HERE AND THE FILES FROM `repoRoot`, which are two different
  // questions. `@openref/render` is this tool's own dependency, so it is found the way any of its
  // dependencies is; what tree is being weighed is decided entirely by the paths above.
  const load: (id: string) => unknown = createRequire(import.meta.url);
  const api = load('@openref/render') as RenderAssetApi;
  // ONE PLAN AND ONE CATALOG, BECAUSE A READER RECEIVES ONE SERVED REFERENCE. The consequence is
  // stated rather than hidden: `theme-css-raw` needs `packages/nest/dist/browser/openref.js` to
  // exist, so a tree with the theme built and the client bundle not built fails the stylesheet row
  // instead of measuring it, naming the missing file. Two plans would remove the coupling and
  // would also let the two rows come to describe two different servings of one page.
  const plan = api.loadDefaultAssets({
    clientBundle: join(repoRoot, CLIENT_JS_ENTRY),
    stylesheets,
  });
  const catalog = api.buildAssetCatalog(plan.sources);

  const form = new Map(catalog.assets.map((asset) => [asset.name, asset.bytes]));

  cache.set(repoRoot, form);

  return form;
}

/** Forgets what was read, so a test can measure two trees in one process. */
export function forgetPublishedForm(): void {
  cache.clear();
}
