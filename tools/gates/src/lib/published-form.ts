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
import { CLIENT_JS_ENTRY, SHIPPED_CLIENT_BUNDLES, THEME_CSS_ROOTS } from '../config.js';
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

/**
 * Which served reference a budget's files belong to, named by the entry it is assembled from.
 *
 * THERE IS MORE THAN ONE SERVED REFERENCE AND ONE CATALOG CANNOT HOLD THEM, since 2026-09-02.
 * `theme-entry` weighs the browser entry `@openref/theme-telltale` ships, which a host serves
 * through `theme.bundle`, and five of its eighteen files are in no asset of the default
 * reference's catalog: `entry.js`, `Layout-QKVO2HRR.js`, `runner-factory-M2UOVO3U.js`,
 * `search-factory-KMK3T2QN.js` and `chunk-4HSEIUWQ.js`. Measured, not assumed: the other thirteen
 * names are shared and byte identical on this tree, all thirteen, because a chunk's name carries
 * the hash of its contents. Merging the two into one catalog is not the alternative, it is the
 * defect: two sources of one name is what a served reference cannot contain, which is why the
 * budget report refuses such a pair rather than weighing one of them twice.
 *
 * THE MAPPING IS THE LIST THAT ALREADY EXISTS. `SHIPPED_CLIENT_BUNDLES` names every entry this
 * repository publishes and the roots its chunk closure lands in, and the deferral audit already
 * reads it. A second list here is how the two would come to disagree about what ships.
 *
 * @param roots - The repository relative roots the budget walks
 * @returns Repository relative path of the entry the reference is assembled from
 * @throws Error when the roots name no shipped bundle and no stylesheet the default one serves
 */
export function servedReferenceOf(roots: readonly string[]): string {
  const bundles = SHIPPED_CLIENT_BUNDLES.filter((bundle) =>
    bundle.roots.some((root) => roots.includes(root)),
  );

  // MORE THAN ONE IS A REFUSAL RATHER THAN THE FIRST MATCH. A budget spanning two shipped entries
  // has no single served reference, so picking one would weigh half of it against the other's
  // catalog, silently. No budget on the published form does this today, and the two Web Component
  // rows, which do span two entries, are the reason it could be reached without one being written.
  if (bundles.length > 1) {
    throw new Error(
      `the roots ${roots.join(', ')} span ${String(bundles.length)} shipped bundles, ` +
        `${bundles.map((bundle) => bundle.file).join(' and ')}, so which served reference this ` +
        'budget belongs to is undecided',
    );
  }

  const bundle = bundles[0];
  if (bundle !== undefined) return bundle.file;

  // THE STYLESHEETS BELONG TO THE DEFAULT REFERENCE, because that is the page they are linked
  // from. They are not an entry of their own and never appear in `SHIPPED_CLIENT_BUNDLES`.
  if (roots.some((root) => THEME_CSS_ROOTS.includes(root))) return CLIENT_JS_ENTRY;

  throw new Error(
    `the roots ${roots.join(', ')} belong to no served reference: they name none of the shipped ` +
      `bundles ${SHIPPED_CLIENT_BUNDLES.map((bundle) => bundle.file).join(', ')} and none of the ` +
      `stylesheets ${THEME_CSS_ROOTS.join(', ')} the default one serves`,
  );
}

/**
 * Cached per repository root and entry, because six budgets ask the same question of one build.
 */
const cache = new Map<string, PublishedForm>();

/**
 * Reads every asset a served reference is made of and returns its published size.
 *
 * @param repoRoot - Absolute repository root
 * @param bundle - Repository relative entry the reference is assembled from
 * @returns Published bytes by disk file name
 * @throws Error when the renderer or the built artefacts cannot be reached, naming which
 */
export function readPublishedForm(
  repoRoot: string,
  bundle: string = CLIENT_JS_ENTRY,
): PublishedForm {
  // A PAIR RATHER THAN A JOINED STRING, because a separator either appears in a path or does not
  // and neither answer is worth checking: two roots and two entries have to be four cache entries.
  const key = JSON.stringify([repoRoot, bundle]);
  const cached = cache.get(key);
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
  // ONE PLAN AND ONE CATALOG PER SERVED REFERENCE, BECAUSE A READER RECEIVES ONE. The consequence
  // is stated rather than hidden: `theme-css-raw` needs `packages/nest/dist/browser/openref.js` to
  // exist, so a tree with the theme built and the client bundle not built fails the stylesheet row
  // instead of measuring it, naming the missing file. Two plans over one reference would remove
  // the coupling and would also let the two rows come to describe two different servings of one
  // page; two plans over TWO references, which is what the `bundle` parameter is, is the opposite
  // and is what a themed entry needs, since a host serving telltale serves a different page.
  const plan = api.loadDefaultAssets({
    clientBundle: join(repoRoot, bundle),
    stylesheets,
  });
  const catalog = api.buildAssetCatalog(plan.sources);

  const form = new Map(catalog.assets.map((asset) => [asset.name, asset.bytes]));

  cache.set(key, form);

  return form;
}

/** Forgets what was read, so a test can measure two trees in one process. */
export function forgetPublishedForm(): void {
  cache.clear();
}
