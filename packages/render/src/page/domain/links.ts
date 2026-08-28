/**
 * Where a page lives.
 *
 * One place decides this, because the server route table, the links in the navigation and
 * the file names a static build writes have to agree. A disagreement between them is a
 * broken link that no test of any single one of the three would catch.
 */

/** Path of the document overview, relative to the mount point. */
export const OVERVIEW_PATH = '/';

/**
 * Characters that never survive into a path segment.
 *
 * Two families, each with its own reason. The directional and ordering controls, U+061C,
 * U+200E, U+200F, U+202A to U+202E and U+2066 to U+2069, survive NFC and reorder what a
 * terminal, a diff or a file listing shows, so a file named with one is a file whose displayed
 * name and real name disagree (F13's residual, filed against T039). The C0 controls, DEL and
 * the characters `/ \ : * ? " < > |` are refused by one filesystem or another, or change what
 * path a name is, so a segment carrying one either fails to write or writes somewhere the link
 * does not point.
 */
const UNSAFE_SEGMENT_CHARACTER =
  /[\u0000-\u001f\u007f\\/:*?"<>|\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * A literal underscore that would read as one of this file's own escapes.
 *
 * Escaped first, so that an id which happens to contain the text `_u202e_` cannot collide with
 * the escape of an id that contains the character U+202E. With this guard the mapping is
 * injective: every `_u<hex>_` in the output was written by this file.
 */
const ESCAPE_LOOKALIKE = /_(?=u[0-9a-f]{1,6}_)/g;

/** One character as this file escapes it. */
function escapeSegmentCharacter(character: string): string {
  const codePoint = character.codePointAt(0) ?? 0;
  return `_u${codePoint.toString(16).padStart(4, '0')}_`;
}

/**
 * The path segment of one id: the stated function of the T039 amendment, not an interpolation.
 *
 * ONE FUNCTION FOR THE LINK AND FOR THE NAME ON DISK. The hrefs below call it before URL
 * encoding, and the static build derives a file name from the same call, so the two cannot
 * disagree: a static host decodes the URL escapes and lands on exactly these characters. For
 * an ordinary id the function is the identity, so no existing address changes.
 *
 * A segment that is `.` or `..` is escaped whole: both are path grammar, not names.
 *
 * @param id - Node or schema id, exactly as the document registered it
 * @returns The segment, safe as a file name and readable in a terminal
 */
export function pathSegmentOf(id: string): string {
  const guarded = id.replace(ESCAPE_LOOKALIKE, '_u005f_');
  const escaped = guarded.replace(UNSAFE_SEGMENT_CHARACTER, escapeSegmentCharacter);

  if (escaped === '.') return '_u002e_';
  if (escaped === '..') return '_u002e__u002e_';
  return escaped;
}

/**
 * Path of one node's page.
 *
 * The node id is already a slug produced by `operationNodeId`, but it goes through
 * {@link pathSegmentOf} and URL encoding anyway: the id is derived from a path template
 * written in a third party document, and treating it as safe because it usually is would be
 * the last assumption anyone checks.
 *
 * @param nodeId - Key into `IRDocument.nodes`
 * @param basePath - Where the reference is mounted, without a trailing slash
 * @returns Absolute path of the page
 */
export function nodeHref(nodeId: string, basePath = ''): string {
  return `${basePath}/${encodeURIComponent(pathSegmentOf(nodeId))}`;
}

/**
 * Path of the overview page.
 *
 * @param basePath - Where the reference is mounted, without a trailing slash
 * @returns Absolute path of the overview
 */
export function overviewHref(basePath = ''): string {
  return basePath === '' ? OVERVIEW_PATH : basePath;
}

/** Segment under which the whole navigation is served, per page slice of it. */
export const NAVIGATION_SEGMENT = '_navigation';

/**
 * Where the rest of the navigation is fetched from.
 *
 * ADDRESSED BY DOCUMENT HASH, so the response is immutable and a reader who has it never asks
 * again, and so a deployment that changes the document changes the url rather than serving a
 * navigation that does not match the page holding it. The hash is already in the page, as
 * `PageModel.documentHash`, so nothing has to be threaded through to build this.
 *
 * @param documentHash - `IRDocument.hash`
 * @param basePath - Where the reference is mounted, without a trailing slash
 * @returns Absolute path of the navigation payload
 */
export function navigationHref(documentHash: string, basePath = ''): string {
  return `${basePath}/${NAVIGATION_SEGMENT}/${encodeURIComponent(documentHash)}`;
}

/** Segment under which the full text index of SPEC 11 is served, per the table of SPEC 13.3. */
export const SEARCH_INDEX_SEGMENT = '_search-index';

/**
 * Where the full text index is fetched from.
 *
 * NOT ADDRESSED BY DOCUMENT HASH, unlike {@link navigationHref}, and that is a fact about the
 * two producers rather than a choice made here: the route `@openref/nest` registers and the file
 * a static build writes are both one address per mount, per SPEC 13.3 and SPEC 16. So the
 * response cannot be trusted from its url the way a hash addressed one can, and the page checks
 * the hash the index carries against its own instead. See `readSearchIndex` in `search-source.ts`.
 *
 * THE ADDRESS IS RELATIVE AND THE HOST NAME HAS NOWHERE TO ENTER, which is how SPEC 19.4 holds
 * here: the only input is the mount point the page was served under.
 *
 * @param basePath - Where the reference is mounted, without a trailing slash
 * @returns Absolute path of the search index
 */
export function searchIndexHref(basePath = ''): string {
  return `${basePath}/${SEARCH_INDEX_SEGMENT}`;
}

/**
 * Segment of the proxy, the dynamic one of SPEC 14.5 and the static rules of SPEC 16.2 alike.
 *
 * HERE SINCE `T040`, MOVED FROM `@openref/nest`, because two producers on opposite sides of the
 * dependency graph speak it: the Nest module registers the SPEC 14.5 route on this segment, and
 * the static build writes the SPEC 16.2 rewrite rules under it, one rule per pinned upstream at
 * `<base>/_proxy/u<N>/...`. This module is the one package both can see, and it already owns the
 * address space, per SPEC 16.1. `@openref/nest` re-exports it, so its public surface is
 * unchanged.
 */
export const PROXY_SEGMENT = '_proxy';

/** Segment that separates a schema page from a node page, so the two id spaces cannot collide. */
export const SCHEMA_SEGMENT = 'schema';

/** Segment of the bench page, per SPEC 13.3: the console on its own address. */
export const BENCH_SEGMENT = 'bench';

/** Segment of the health page. The liveness JSON lives at `_health`, per SPEC 13.3. */
export const HEALTH_PAGE_SEGMENT = 'health';

/** Segment of the shapes showcase, addressed by schema, per SPEC 11. */
export const SHAPES_SEGMENT = 'shapes';

/** Segment of the states showcase, per SPEC 11. */
export const STATES_SEGMENT = 'states';

/**
 * Path of one operation's bench page.
 *
 * The console left the node page with `TX-FRAME`, so this is where a reader sends a request
 * from. A channel has none: nothing links here for one, and the route answers 404.
 *
 * @param nodeId - Key into `IRDocument.nodes`
 * @param basePath - Where the reference is mounted, without a trailing slash
 * @returns Absolute path of the page
 */
export function benchHref(nodeId: string, basePath = ''): string {
  return `${basePath}/${BENCH_SEGMENT}/${encodeURIComponent(pathSegmentOf(nodeId))}`;
}

/**
 * Path of the Documentation Health page, per SPEC 7.3 as amended 2026-08-14.
 *
 * @param basePath - Where the reference is mounted, without a trailing slash
 * @returns Absolute path of the page
 */
export function healthPageHref(basePath = ''): string {
  return `${basePath}/${HEALTH_PAGE_SEGMENT}`;
}

/**
 * Path of one schema's shapes page: the theme author's showcase, reached by URL and linked
 * from no bar and no tree, per the 2026-08-14 decision.
 *
 * @param schemaId - Key into `IRDocument.schemas`
 * @param basePath - Where the reference is mounted, without a trailing slash
 * @returns Absolute path of the page
 */
export function shapesHref(schemaId: string, basePath = ''): string {
  return `${basePath}/${SHAPES_SEGMENT}/${encodeURIComponent(pathSegmentOf(schemaId))}`;
}

/**
 * Path of the states showcase, under the same rule as {@link shapesHref}.
 *
 * @param basePath - Where the reference is mounted, without a trailing slash
 * @returns Absolute path of the page
 */
export function statesHref(basePath = ''): string {
  return `${basePath}/${STATES_SEGMENT}`;
}

/**
 * Path of one named schema's page.
 *
 * A schema gets a page of its own for two reasons. The navigation already ends in a `Schemas`
 * group, which T004 appends and which had nowhere to link to; and a schema too far from a use
 * site to travel with the page is shown by linking to it rather than by being unreachable.
 *
 * THE ID IS THE STORED ONE, SUFFIX AND ALL. An external target is registered as
 * `<name>__<8 hex>` per SPEC 5.1.1 and the suffix is identity, not display: it belongs in the
 * URL, where identity is what a link needs, and nowhere a reader is shown.
 *
 * @param schemaId - Key into `IRDocument.schemas`
 * @param basePath - Where the reference is mounted, without a trailing slash
 * @returns Absolute path of the page
 */
export function schemaHref(schemaId: string, basePath = ''): string {
  return `${basePath}/${SCHEMA_SEGMENT}/${encodeURIComponent(pathSegmentOf(schemaId))}`;
}
