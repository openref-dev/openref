/**
 * What this theme's components need from the browser, said structurally.
 *
 * THE RULE IS THE PROJECT'S AND THE FILE IS A FINDING. T011 scoped DOM types to `src/browser` and
 * the integration suite so that a server only path cannot reach `document` by accident and so that
 * `tsc` over the main program fails when one tries. A theme's components render on the server and
 * in the browser, so they are inside that program and cannot name a DOM type. `@openref/render`
 * has this file too, as `shared/dom.ts`: 11 shapes there, 11 here, 5 of them the same. It is a
 * private package, so a theme author cannot reach any of them and writes them again. Recorded in
 * `THEME-BOUNDARY.md`, finding 6, rather than worked around by adding `"lib": ["DOM"]` to this
 * package, which would compile and would put `document` within reach of every component here.
 *
 * THE CROSS REFERENCE ABOVE WAS DANGLING UNTIL `T031-R1`: this comment named a section of that
 * document which had never been written, so the transcription was recorded nowhere and checked by
 * nothing. It now has a case in `test/integration/theme-boundary.spec.ts` which pins the five
 * shared names, compares both transcribed functions against the reference's over the same events,
 * and holds the three shared shapes mutually assignable at compile time. The route table next
 * door had a case and drifted anyway, because the case compared one of its three rules; that is
 * the standard this one is written to.
 *
 * These are not re-declarations of the DOM. They are the handful of members this theme touches,
 * and anything structurally compatible satisfies them, which is also what makes them testable
 * with no browser.
 */

/** What carries the new value of a control. */
export interface ValueEvent {
  readonly target?: { readonly value?: unknown } | null;
}

/**
 * The value of a control, or the empty string when the event carries none.
 *
 * Narrowed rather than asserted, because the event is the browser's. An event with no usable value
 * yields an empty field rather than throwing inside a listener, where nothing could catch it.
 *
 * @param event - The input or change event
 * @returns The value as a string
 */
export function eventValue(event: ValueEvent): string {
  const value = event.target?.value;
  return typeof value === 'string' ? value : '';
}

/** A file the reader picked: the three members a body part is built from, and nothing else. */
export interface PickedFile {
  readonly name: string;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** What carries the files of a file input. */
export interface FileEvent {
  readonly target?: { readonly files?: ArrayLike<PickedFile> | null } | null;
}

/**
 * The first file of a file input, or null when the reader cleared it.
 *
 * @param event - The change event
 * @returns The file, or null
 */
export function eventFile(event: FileEvent): PickedFile | null {
  const files = event.target?.files;
  if (files === undefined || files === null || files.length === 0) return null;
  return files[0] ?? null;
}

/** An element this theme reads a heading off, and writes an id back to. */
export interface HeadingElement {
  id: string;
  readonly textContent: string | null;
}

/** The members of `document` this theme uses, and no others. */
export interface DocumentLike {
  getElementsByTagName(tag: string): ArrayLike<unknown>;
  querySelectorAll(selector: string): ArrayLike<HeadingElement>;
}

/** One entry of the resource timing buffer, reduced to what a byte count needs. */
export interface ResourceTiming {
  readonly initiatorType?: string;
  readonly transferSize?: number;
}

/** The one member of `performance` this theme uses. */
export interface PerformanceLike {
  getEntriesByType?: (type: string) => ArrayLike<ResourceTiming>;
}

/**
 * The document, when there is one.
 *
 * REACHED THROUGH `globalThis` AND TYPED AS OPTIONAL, which is the honest shape: on the server
 * there is no document, and a component that declared one would be a component that says the
 * server has a browser in it. Every caller is inside `onMounted`, where the answer is never
 * undefined, and the check stays anyway because a type that cannot be undefined is a promise this
 * file is not in a position to make.
 *
 * @returns The document, or undefined outside a browser
 */
export function browserDocument(): DocumentLike | undefined {
  return (globalThis as { document?: DocumentLike }).document;
}

/**
 * The performance timeline, when there is one.
 *
 * @returns The timeline, or undefined where the environment has none
 */
export function browserPerformance(): PerformanceLike | undefined {
  return (globalThis as { performance?: PerformanceLike }).performance;
}
