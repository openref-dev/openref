import type { IRDocument } from '@openref/core';

/** Where a document comes from, resolved from a command's own flags. */
export type DocumentSource =
  | { readonly kind: 'spec'; readonly path: string }
  | { readonly kind: 'config'; readonly path: string }
  | { readonly kind: 'from-nest'; readonly path: string }
  /**
   * One path inside one git revision, per SPEC 17.1 as amended by T041. `cwd` is where git is
   * run and what a relative `path` is resolved against, so a git side and a file side of the
   * same diff answer the same string the same way.
   */
  | { readonly kind: 'git'; readonly ref: string; readonly path: string; readonly cwd?: string };

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
