/**
 * The client half: read the state the server wrote, hydrate, stop.
 *
 * What is NOT here is the point of the file. No markdown parser, no sanitizer, no
 * highlighter, no IR: descriptions arrive as HTML the server already sanitized and code
 * arrives already tokenized, which is what keeps SPEC 12's promise that the highlighter
 * never reaches the browser.
 *
 * Nothing here fetches anything. The state is in the document, per SPEC 19.4.
 */

import { createSSRApp } from 'vue';
import { APP_ROOT_ID, ReferenceApp } from '../components/ReferenceApp';
import { STATE_ELEMENT_ID } from '../page/domain/shell';
import type { PageModel } from '../page/domain/page-model';

/** What `hydrateReference` needs to find its way around a document. */
export interface HydrateOptions {
  /** Document to hydrate in. Defaults to the global one. */
  readonly document?: Document;
  /** Where the reference is mounted, so client rendered links match the server's. */
  readonly basePath?: string;
}

/**
 * Reads the page model out of the state element.
 *
 * Returns null rather than throwing when the element is missing or unparseable. A page
 * whose state block was stripped by a proxy still shows the server rendered markup, and
 * turning that into an exception would replace a working static page with a blank one.
 *
 * @param root - Document to read from
 * @returns The page model, or null when there is none to read
 */
export function readPageState(root: Document): PageModel | null {
  const element = root.getElementById(STATE_ELEMENT_ID);
  if (element === null) return null;

  // An element's textContent is a string, never null; only a document or a doctype gives
  // null, and getElementById returns neither.
  const text = element.textContent;
  if (text.trim() === '') return null;

  try {
    return JSON.parse(text) as PageModel;
  } catch {
    return null;
  }
}

/**
 * Hydrates the server rendered markup.
 *
 * @param options - Document and mount point
 * @returns True when the application was hydrated, false when there was nothing to hydrate
 */
export function hydrateReference(options: HydrateOptions = {}): boolean {
  const root = options.document ?? globalThis.document;
  const mount = root.getElementById(APP_ROOT_ID);
  if (mount === null) return false;

  const page = readPageState(root);
  if (page === null) return false;

  createSSRApp(ReferenceApp, { page, basePath: options.basePath ?? '' }).mount(mount);

  return true;
}

export { APP_ROOT_ID, ReferenceApp, STATE_ELEMENT_ID };
export type { PageModel };
