/**
 * The one composition a browser entry performs, reusable by a themed entry.
 *
 * WHY THIS IS A MODULE AND NOT A PARAGRAPH IN `entry.ts`. A theme with component overrides
 * reaches a reader only inside an entry built with its definition, per the T033 decision:
 * one bundle, therefore one `@openref/vue` instance, therefore `inject` reads the key
 * `provide` wrote. Every such entry needs exactly what the default entry needs beside the
 * theme, the runner factory behind the Send gesture with its proxy branch, and a theme
 * package writing that composition out by hand would carry a second copy of a security
 * relevant branch that this package already owns. So the composition is exported once, from
 * the package that is allowed to see all of its parts, and a themed entry is two imports and
 * one call.
 *
 * The first themed entry artefact shipped by a theme package is its first consumer; the
 * default `entry.ts` is the zeroth.
 *
 * THE `./browser-entry` EXPORT CARRIES THE `source` CONDITION AND NOTHING ELSE, deliberately.
 * A built form would either name `@openref/render` bare, which no browser resolves and the
 * `browser-resolution` gate rightly refuses, or pre-bundle Vue, which hands the theme's own
 * build a second instance, the exact defect this arrangement prevents. So the surface resolves
 * where themes are built today, inside this workspace, and fails loudly outside it; whether a
 * third party theme author gets a resolvable form is the `@openref/render` publication
 * question, which the T064 amendment owns.
 */

import { hydrateReference, type ThemeDefinition } from '@openref/render/browser';

/**
 * Hydrates the served page, with the runner arriving on the Send gesture and the search index on
 * the first open of the palette.
 *
 * BOTH FACTORIES ARE DYNAMIC IMPORTS AND NEITHER IS A CHOICE ABOUT TIDINESS. `@openref/runner`
 * and `@openref/search` are each larger than the whole first paint, and each serves one gesture,
 * so each travels in the chunk that gesture fetches. Writing either call inline here would put
 * it in the first paint chunk of every page.
 *
 * THE SEARCH HALF IS WHAT T042 PAID. The index has been built, budgeted and served at
 * `<mount>/_search-index` since T007, and until this line no file this module shipped ever asked
 * for it: `useSearch` answered `available: false` on every page, and the palette matched
 * navigation labels and hints alone. The renderer performs the fetch, because the address is
 * relative to a mount point only it knows; this supplies the half the renderer may not import.
 *
 * @param theme - The definition this entry was built with, or nothing for the reference's own
 */
export function mountReference(theme?: ThemeDefinition): void {
  hydrateReference({
    ...(theme === undefined ? {} : { theme }),
    loadRunner: async (model) => (await import('./runner-factory')).createPageRunner(model),
    loadSearch: async (model) => (await import('./search-factory')).createPageSearch(model),
  });
}
