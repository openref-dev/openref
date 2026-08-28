/**
 * Carrying an unchanged page forward across a document that changed elsewhere.
 *
 * THE PROBLEM THIS SOLVES IS THE ONE THING THAT MAKES A REBUILD NOT INCREMENTAL. Every page
 * carries `documentHash` in its state block, because that is what it fetches the rest of the
 * navigation by, and one changed operation changes the hash of the whole document. So a page
 * whose own bytes are otherwise identical still has one field to update, and re-rendering it to
 * change one string would make every rebuild a full one.
 *
 * SO AN UNCHANGED PAGE IS RE-ADDRESSED RATHER THAN RE-RENDERED. The previous file is read, the
 * application markup and the title are taken from it by the shell's own markers, the state
 * block is parsed as JSON and given the new hash, and the shell is assembled again from those
 * parts. The result is byte identical to what a full render would have produced, which is what
 * the test asserts rather than assumes.
 *
 * THE HASH IS IN THE MARKUP TOO, AND THE FIRST VERSION OF THIS FILE MISSED IT. `ReferenceApp`
 * writes `data-oref-document="<hash>"` on the root element, so a page whose state block alone
 * was re-addressed would have carried a stale hash in its own markup: the two halves of one
 * page disagreeing about which document they are, which is the silent class of defect this
 * whole build is written to avoid. Measured by rendering one document twice with an unrelated
 * operation changed and diffing the markup, which differed at byte 43 of 2902 and nowhere
 * else. Every occurrence of the previous hash is replaced, so a second place that writes it is
 * covered the day it is added rather than the day somebody notices.
 *
 * EVERY FAILURE IS A FULL RENDER, NEVER A BROKEN FILE. A file somebody edited, a file from an
 * older `RENDER_VERSION`, a state block that is not JSON: each returns null here and the caller
 * renders the page. That is the only safe direction, because the alternative is writing a page
 * assembled from parts nobody checked.
 */

import { STATE_ELEMENT_ID, type RenderedPage } from '@openref/render';

/**
 * The head of the state element, exactly as the shell writes it for a static page.
 *
 * NO NONCE ATTRIBUTE, because the shell writes one exactly when it is handed a nonce and a
 * static build never has one to give: a file on disk is one response reused. The refusal of a
 * nonce carrying tag is spelled out as a lookahead rather than left to the closing bracket,
 * for two reasons that end in the same text: it names the one legacy shape this build refuses,
 * the era when the shell wrote an empty `nonce=""` here, and it keeps `nonce=` in the tag's
 * own source text, which the CSP scan of built output reads and would otherwise take for a
 * state block that forgot its nonce. A file in that legacy shape fails this match and takes
 * the designed exit, a full render, after which the file on disk is in the current shape.
 */
const STATE_OPEN = new RegExp(
  `<script type="application/json" id="${STATE_ELEMENT_ID}"(?! nonce=")>`,
);

/** What a previous page file was made of. */
export interface RecoveredPage {
  readonly title: string;
  readonly appHtml: string;
  /** The state block as it was written, with `<` still escaped. */
  readonly stateJson: string;
}

/** The one marker the application markup sits between, written by the shell. */
const APP_OPEN = /<div id="([^"]+)">/;

/**
 * Reads back the parts of a page the shell assembled.
 *
 * @param html - A file this build wrote earlier
 * @param appRootId - Id of the application root element, as the renderer names it
 * @returns The parts, or null when the file is not one this build can take apart
 */
export function recoverPage(html: string, appRootId: string): RecoveredPage | null {
  const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(html);
  if (titleMatch === null) return null;

  const appOpenMatch = APP_OPEN.exec(html);
  if (appOpenMatch?.[1] !== appRootId) return null;

  const appStart = appOpenMatch.index + appOpenMatch[0].length;

  const stateOpenMatch = STATE_OPEN.exec(html);
  if (stateOpenMatch === null) return null;

  // The application markup ends where the state block begins, minus the closing `</div>` the
  // shell writes between them. Checked rather than assumed: a file that does not end that way
  // is a file this function does not understand.
  const appEnd = stateOpenMatch.index - '</div>'.length;
  if (appEnd < appStart || html.slice(appEnd, stateOpenMatch.index) !== '</div>') return null;

  const stateStart = stateOpenMatch.index + stateOpenMatch[0].length;
  const stateEnd = html.indexOf('</script>', stateStart);
  if (stateEnd === -1) return null;

  return {
    title: unescapeHtml(titleMatch[1] ?? ''),
    appHtml: html.slice(appStart, appEnd),
    stateJson: html.slice(stateStart, stateEnd),
  };
}

/**
 * The same page, addressed to a new document hash.
 *
 * @param html - The previous file
 * @param appRootId - Id of the application root element
 * @param documentHash - Hash of the document this build is about
 * @param nodeId - Node of the page, for the returned record
 * @param schemaId - Schema of the page, for the returned record
 * @returns The page as the shell takes it, or null when the file could not be reused
 */
export function readdressPage(
  html: string,
  appRootId: string,
  documentHash: string,
  nodeId: string | null,
  schemaId: string | null,
): RenderedPage | null {
  const recovered = recoverPage(html, appRootId);
  if (recovered === null) return null;

  let state: unknown;
  try {
    // `escapeJsonForScript` only ever replaced `<`, so undoing that yields the JSON the
    // renderer serialized. Anything else in there is not a state block this build wrote.
    state = JSON.parse(recovered.stateJson.replace(/\\u003c/g, '<'));
  } catch {
    return null;
  }

  if (typeof state !== 'object' || state === null) return null;
  const model = state as Record<string, unknown>;
  const previousHash = model.documentHash;
  if (typeof previousHash !== 'string' || previousHash === '') return null;

  // KEY ORDER IS PRESERVED BY REPLACING THE VALUE IN PLACE, which matters for the same reason
  // `serializePageModel` refuses `canonicalize`: the page model's key order is the document's
  // authored order, and a rebuild that reordered it would produce bytes a full render never
  // would, so the two paths would stop being interchangeable.
  model.documentHash = documentHash;

  return {
    documentHash,
    nodeId,
    schemaId,
    title: recovered.title,
    appHtml: replaceAll(recovered.appHtml, previousHash, documentHash),
    stateJson: JSON.stringify(model),
  };
}

/** Every occurrence of one literal, replaced, with nothing in the needle read as a pattern. */
function replaceAll(text: string, needle: string, replacement: string): string {
  return text.split(needle).join(replacement);
}

/** The four entities `escapeHtml` writes, undone. */
function unescapeHtml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
