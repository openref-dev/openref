/**
 * What a component needs from the browser, said structurally.
 *
 * DOM TYPES ARE SCOPED TO `src/browser` AND THE INTEGRATION SUITE, decided in T011, so that a
 * server only path cannot reach `document` by accident and so that `tsc` over the main program
 * fails when one tries. A component renders on the server as well as in the browser, so it
 * cannot sit inside that scope, and it says here exactly which members it uses.
 *
 * These are not re-declarations of the DOM: they are the four things the reference UI touches.
 * Anything structurally compatible satisfies them, which is also what makes them testable
 * without a browser.
 */

/** A keyboard event, as a component reads it. */
export interface KeyEvent {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  preventDefault(): void;
}

/** What carries the new value of an input, said structurally. */
export interface ValueTarget {
  readonly value?: unknown;
}

/** An input or change event, as a component reads the value off it. */
export interface ValueEvent {
  readonly target?: ValueTarget | null;
}

/**
 * The new value of a control, or the empty string when the event carries none.
 *
 * Narrowed rather than asserted, because the event is the browser's and this file compiles in
 * a program with no DOM types. An event with no usable value yields an empty field rather than
 * throwing inside a listener, where nothing could catch it.
 *
 * @param event - The input or change event
 * @returns The value as a string
 */
export function eventValue(event: ValueEvent): string {
  const value = event.target?.value;

  return typeof value === 'string' ? value : '';
}

/**
 * A file the reader picked, said structurally.
 *
 * The three members a body part is built from, and nothing else. `arrayBuffer` is what a browser
 * `File` reads its bytes with, and declaring it here rather than importing `File` keeps this file
 * in the server program where there is no such type.
 */
export interface PickedFile {
  readonly name: string;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** A file input's change event, as a component reads the chosen file off it. */
export interface FileEvent {
  readonly target?: { readonly files?: ArrayLike<PickedFile> | null } | null;
}

/**
 * The file a reader chose, or null when they cleared the control.
 *
 * ONE FILE AND NOT A LIST, because a body part is one file: a property declared as a binary
 * string is one file, and a document that wants several declares an array, which is a shape the
 * console does not offer yet and says so rather than silently sending the first.
 *
 * @param event - The change event from a file input
 * @returns The file, or null when none was chosen
 */
export function eventFile(event: FileEvent): PickedFile | null {
  const files = event.target?.files;
  if (files === undefined || files === null || files.length === 0) return null;

  const file: PickedFile | undefined = files[0];

  return file ?? null;
}

/** Something that can take focus, and that says which row it is. */
export interface FocusTarget {
  focus(): void;
  getAttribute(name: string): string | null;
}

/** Something that can be searched for focus targets. */
export interface QueryRoot {
  querySelectorAll(selectors: string): Iterable<FocusTarget>;
}

/** Something a global key listener can be attached to, which is the document. */
export interface ListenerHost {
  addEventListener(type: string, listener: (event: KeyEvent) => void): void;
  removeEventListener(type: string, listener: (event: KeyEvent) => void): void;
}

/**
 * The document, when there is one.
 *
 * Reached through `globalThis` rather than through the DOM lib, so this file compiles in the
 * server program and returns null there instead of throwing. A component that finds null
 * attaches no listener, which is the correct behaviour during a server render.
 *
 * @returns The global document, or null when the code is not running in a browser
 */
export function listenerHost(): ListenerHost | null {
  const candidate = (globalThis as { document?: unknown }).document;

  if (candidate === null || typeof candidate !== 'object') return null;

  const host = candidate as Partial<ListenerHost>;
  return typeof host.addEventListener === 'function' &&
    typeof host.removeEventListener === 'function'
    ? (candidate as ListenerHost)
    : null;
}
