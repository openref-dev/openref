/**
 * Where a page lives, as this theme has to work it out for itself.
 *
 * THIS FILE IS A FINDING BEFORE IT IS A UTILITY. `NavTree` is handed `NavEntryModel`s carrying a
 * `nodeId` and a `schemaId`, plus `basePath`, and it has to build the link. `CommandPalette` is
 * handed `PaletteHitModel`s that already carry a finished `href`. So one position of the contract
 * is given the answer and the other is given the parts, and the parts can only be assembled by
 * knowing the reference's own route table, which is in `@openref/render` and is not published.
 *
 * The rules below are transcribed from `packages/render/src/page/domain/links.ts`. A theme
 * that transcribed one of them wrong ships a reference whose every navigation link is a 404, and
 * nothing in the contract, the conformance checker or this theme's own tests would say so: they
 * are `href` strings, and a wrong string is a string. `theme-boundary.spec.ts` is what makes them
 * fail here instead, by driving the links through the renderer's own route shapes.
 *
 * IT GREW BY ONE RULE AT T039, WHICH IS THE FINDING GETTING LARGER RATHER THAN SMALLER. An id no
 * longer goes into a path through `encodeURIComponent` alone: it goes through a stated escape
 * first, so that the link and the file name a static build writes are produced by one function
 * and cannot disagree, and so that a directional control never reaches a file name. That escape
 * is now a fourth thing an external theme has to reproduce exactly, character class and all, and
 * a theme that reproduces it approximately ships links that 404 only for the ids it differs on.
 * Recorded here rather than worked around: the boundary problem this file documents is now
 * measurably worse, and the fix is for the link builders to be published rather than copied.
 *
 * AND IT GREW AGAIN AT T043, WHICH THIS FILE MISSED FOR A FORTNIGHT. The renderer added two whole
 * name rules beside the character rule: a reserved Windows device name is escaped on its first
 * character, and a name ending in a dot or a space has that last character escaped, because Win32
 * strips it and merges two pages into one file. This transcription had neither until `T031-R1`
 * measured it, so every link this theme drew to a schema called `CON`, `NUL` or `Order.` pointed
 * at an address the server does not serve. Nothing went red, which is the point of the finding:
 * the case that exists to catch exactly this compared one of the three rules.
 *
 * It is not worked around by importing the renderer. See `THEME-BOUNDARY.md`.
 */

/**
 * Characters that never survive into a path segment, transcribed from the renderer.
 *
 * The directional and ordering controls, which survive NFC and reorder what a terminal or a file
 * listing shows; and the C0 controls, DEL and the characters a filesystem refuses or reads as
 * path structure.
 */
const UNSAFE_SEGMENT_CHARACTER =
  /[\u0000-\u001f\u007f\\/:*?"<>|\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** A literal underscore that would read as one of the renderer's own escapes. */
const ESCAPE_LOOKALIKE = /_(?=u[0-9a-f]{1,6}_)/g;

/**
 * Names Windows refuses whatever extension follows them, transcribed from the renderer.
 *
 * A whole name rule and not a character one, which is why it is a separate pattern: a schema
 * called `CON` writes nowhere on Windows and `NUL` writes to the null device, so the static build
 * reports the page and the reader gets a 404 or an empty file.
 */
const RESERVED_DEVICE_NAME =
  /^(conin\$|conout\$|con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(\..*)?$/i;

/** The last character Win32 strips rather than storing, transcribed from the renderer. */
const TRIMMED_TAIL = /[. ]$/;

/** One character as the renderer escapes it. */
function escapeSegmentCharacter(character: string): string {
  const codePoint = character.codePointAt(0) ?? 0;
  return `_u${codePoint.toString(16).padStart(4, '0')}_`;
}

/** The path segment of one id, transcribed from `pathSegmentOf`: one character rule and two name rules. */
export function pathSegmentOf(id: string): string {
  const guarded = id.replace(ESCAPE_LOOKALIKE, '_u005f_');
  let escaped = guarded.replace(UNSAFE_SEGMENT_CHARACTER, escapeSegmentCharacter);

  if (escaped === '.') return '_u002e_';
  if (escaped === '..') return '_u002e__u002e_';

  // BOTH RULES, NEVER ONE OF THE TWO, for the reason the renderer states: `con` and `con.` would
  // otherwise land in one file, the trailing dot having been stripped by Win32.
  if (RESERVED_DEVICE_NAME.test(escaped)) {
    escaped = `${escapeSegmentCharacter(escaped)}${escaped.slice(1)}`;
  }
  if (TRIMMED_TAIL.test(escaped)) {
    escaped = `${escaped.slice(0, -1)}${escapeSegmentCharacter(escaped.slice(-1))}`;
  }

  return escaped;
}

/** Path of the document overview, relative to the mount point. */
export function overviewHref(basePath: string): string {
  return basePath === '' ? '/' : basePath;
}

/** Path of one node's page. The id is escaped and encoded, since a document supplied it. */
export function nodeHref(nodeId: string, basePath: string): string {
  return `${basePath}/${encodeURIComponent(pathSegmentOf(nodeId))}`;
}

/** Path of one named schema's page, under the segment that keeps the two id spaces apart. */
export function schemaHref(schemaId: string, basePath: string): string {
  return `${basePath}/schema/${encodeURIComponent(pathSegmentOf(schemaId))}`;
}

/** Where an entry of the navigation points, or nothing when it is a group. */
export function entryHref(
  entry: { readonly nodeId: string | null; readonly schemaId: string | null },
  basePath: string,
): string | null {
  if (entry.nodeId !== null) return nodeHref(entry.nodeId, basePath);
  if (entry.schemaId !== null) return schemaHref(entry.schemaId, basePath);
  return null;
}
