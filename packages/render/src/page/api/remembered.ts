/**
 * The remembered operation, per SPEC 11 as amended with `TX-PARITY-UI`: the bar is six
 * constant items, and the SPEC 13.3 rule survives through remembering rather than through
 * hiding.
 *
 * WHAT IS STORED IS THE RESOLVED FRAME AND NEVER A DERIVATION. On an operation or bench page
 * the client records the operation tabs exactly as the server resolved them, the crumb and
 * the node id; on the four pages the maintainer named, schema, health, shapes and states, it
 * merges them back. So no address is ever spelled twice, which is the `links.ts` rule the
 * frame was built under, and a stale memory can point at most at a page the server once
 * answered.
 *
 * THE MEMORY IS PER TAB AND PER DOCUMENT. `sessionStorage`, because a reading session is what
 * the prototypes remember across; the key carries the mount point, so two references on one
 * origin do not swap operations; and the record carries the document hash and applies only
 * while it matches, because a redeployed document may not have the node at all, and
 * forgetting is honest where guessing is not.
 *
 * EVERYTHING HERE RUNS AFTER MOUNT. The server cannot know the reader's memory, so the served
 * bar carries what the server can resolve, and the merge is a post-mount state change, the
 * anchor walk's class: hydration compares the markup the server actually sent.
 */

import type { FrameModel, FrameTabModel } from '@openref/vue';

/** What one memory holds: enough to redraw the operation half of the bar anywhere. */
export interface RememberedOperation {
  readonly documentHash: string;
  readonly nodeId: string;
  readonly crumb: string;
  readonly tabs: readonly FrameTabModel[];
}

/** The kinds the memory carries, which are the operation-bound ones. */
const REMEMBERED_KINDS = new Set(['node', 'schema', 'shapes', 'bench']);

/**
 * Where the memory lives, scoped by mount point so two references cannot swap operations.
 *
 * The prefix deliberately does not look like a class name: the theme's two way sweep reads
 * every `oref-` word the renderer emits, and a storage key is not markup.
 */
function storageKey(basePath: string): string {
  return `openref:last-operation:${basePath}`;
}

/** `sessionStorage` when there is one, reached the `listenerHost` way so this file compiles on the server. */
function storageHost(): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
} | null {
  try {
    const candidate = (globalThis as { sessionStorage?: unknown }).sessionStorage;
    if (candidate === null || typeof candidate !== 'object') return null;

    const host = candidate as { getItem?: unknown; setItem?: unknown };
    return typeof host.getItem === 'function' && typeof host.setItem === 'function'
      ? (candidate as {
          getItem(key: string): string | null;
          setItem(key: string, value: string): void;
        })
      : null;
  } catch {
    // Storage access itself can throw, a hardened or embedded context, and a reference that
    // cannot remember still renders every page it always did.
    return null;
  }
}

/**
 * Records the operation tabs of the page being read.
 *
 * @param basePath - Mount point, which scopes the key
 * @param memory - The resolved tabs, crumb and node id of this page
 */
export function rememberOperation(basePath: string, memory: RememberedOperation): void {
  const storage = storageHost();
  if (storage === null) return;

  try {
    storage.setItem(
      storageKey(basePath),
      JSON.stringify({
        ...memory,
        // Stored inactive, because the memory is read on pages the operation is not open on.
        tabs: memory.tabs
          .filter((tab) => REMEMBERED_KINDS.has(tab.kind))
          .map((tab) => ({ ...tab, active: false })),
      }),
    );
  } catch {
    // A full or refusing storage loses the memory and nothing else.
  }
}

/**
 * The memory for this document, or null: absent, unreadable, or about another document.
 *
 * @param basePath - Mount point, which scopes the key
 * @param documentHash - Hash of the document being read, which the memory must match
 */
export function recallOperation(
  basePath: string,
  documentHash: string,
): RememberedOperation | null {
  const storage = storageHost();
  if (storage === null) return null;

  try {
    const raw = storage.getItem(storageKey(basePath));
    if (raw === null) return null;

    const held = JSON.parse(raw) as Partial<RememberedOperation>;
    if (
      held.documentHash !== documentHash ||
      typeof held.nodeId !== 'string' ||
      typeof held.crumb !== 'string' ||
      !Array.isArray(held.tabs)
    ) {
      return null;
    }

    return held as RememberedOperation;
  } catch {
    return null;
  }
}

/**
 * The bar with the remembered tabs merged in, per SPEC 11: the page's own tabs always win,
 * the remembered ones fill the kinds the page could not resolve, and the order stays the
 * prototype's, operation, schema, shapes, bench, health, states.
 *
 * @param frame - The frame as the server resolved it
 * @param memory - The recalled memory
 * @returns The frame the bar draws after mount
 */
export function mergeRememberedFrame(frame: FrameModel, memory: RememberedOperation): FrameModel {
  const own = new Set(frame.tabs.map((tab) => tab.kind));
  const merged = [
    ...frame.tabs,
    ...memory.tabs.filter((tab) => REMEMBERED_KINDS.has(tab.kind) && !own.has(tab.kind)),
  ];

  const order: readonly string[] = ['node', 'schema', 'shapes', 'bench', 'health', 'states'];
  merged.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));

  return { ...frame, tabs: merged, crumb: memory.crumb };
}
