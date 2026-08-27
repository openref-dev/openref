import type { IRDocument } from '@openref/core';

/** Where a document comes from, resolved from a command's own flags. */
export type DocumentSource =
  | { readonly kind: 'spec'; readonly path: string }
  | { readonly kind: 'config'; readonly path: string }
  | { readonly kind: 'from-nest'; readonly path: string };

/** A document, loaded and ready, with a way to release whatever loading it took. */
export interface LoadedDocument {
  readonly document: IRDocument;
  /**
   * Releases whatever the loader holds. A no-op for a file on disk; for `--from-nest`, closes
   * the booted application.
   *
   * @throws {ShutdownTimeoutError} When an application did not close within its allotted time
   */
  readonly close: () => Promise<void>;
}
