/**
 * The search index loader, in the chunk the palette fetches and in no other.
 *
 * IT IS `runner-factory.ts`'S POSITION IN THE GRAPH, AND FOR THE SAME MEASURED REASON. The
 * renderer may not see `@openref/search`, per STANDARDS 3.5, so the index reaches a page through
 * `ISearchPort` and somebody allowed to see both halves supplies it; this package is that
 * somebody. Written into `compose.ts` instead, MiniSearch and this loader would sit in the first
 * paint chunk of every page for a feature one keystroke deep, which is the 250 KB T012 declined
 * to ship into the page and the reason `full-text-search` was a capability debt at all. Behind
 * the dynamic import they cost the first paint nothing.
 *
 * WHAT REACHES THIS FUNCTION IS ALREADY FETCHED. `@openref/render` performs the request, because
 * it is the module that knows where the reference is mounted and the address is relative to that,
 * per SPEC 19.4; what it cannot do is read the file, because reading it is MiniSearch. So the
 * halves meet here: the body arrives as text and leaves as a queryable index.
 *
 * WHICH DOCUMENT THE INDEX IS ABOUT IS RETURNED RATHER THAN CHECKED HERE, and the split is
 * deliberate. `_navigation` is addressed by document hash and its payload is checked against the
 * page all the same; `_search-index` is one address per mount, per SPEC 13.3, so a deployment
 * that changes the document leaves the url alone and a cache in front of it can answer with the
 * last one, which is a strictly worse position and a check that matters more. `loadSearchIndex`
 * refuses a file of a version this build cannot read, which is one half of the question; the
 * other half, whether it is about this page's document, is asked in `readSearchIndex` in the
 * renderer, where it is asked of every port a host supplies and not only of this one. What this
 * function owes that check is the fact it compares, and a loaded index carries it.
 */

import { loadSearchIndex, type SearchIndex } from '@openref/search';

/**
 * What the renderer hands over: the response body, already fetched.
 *
 * A structural slice rather than an imported type, `runner-factory.ts`'s reasoning: naming the
 * renderer's own would pull `@openref/render/browser` into every program that type checks this
 * file, DOM types and all. It carries the page's document hash too, which this function has no
 * use for and therefore does not name.
 */
interface SearchSource {
  /** Body of `<mount>/_search-index`, exactly as it arrived. */
  readonly serialized: string;
}

/**
 * Loads the index a page fetched.
 *
 * The return type is the search package's own rather than `ISearchPort`, exactly as the runner
 * factory returns a `RequestRunner`: the port is declared in `@openref/vue`, which is not among
 * this package's upstreams, and a loaded index satisfies it structurally, which is the whole way
 * the port works. The `documentHash` on it is what the renderer checks against the page.
 *
 * @param source - The fetched body
 * @returns The queryable index, carrying the hash of the document it was built from
 * @throws {SearchIndexFormatError} When the body is not an index this build can read
 */
export function createPageSearch(source: SearchSource): SearchIndex {
  return loadSearchIndex(source.serialized);
}
