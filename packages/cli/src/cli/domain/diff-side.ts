import { refusedGitArgument } from './git-ref';
import type { DocumentSource } from './loaded-document.types';

/**
 * What one side of `openref diff <old> <new>` names, per SPEC 17.1 as amended by T041.
 *
 * SPEC 17.1's own transcript is `openref diff main current`: two branch names, not two paths.
 * Until T041 nothing in the code could read it, and T038 left the call site saying so. The rule
 * is one rule, read top to bottom, and the top of it is the disk:
 *
 * - a side that names a file that exists is that file, always, even when a branch shares its
 *   name. A caller holding a file in their hand never has it silently swapped for an object out
 *   of history.
 * - a side written `<ref>:<path>` is git's own spelling and is read as git reads it.
 * - a bare side is a ref, and the path under it comes from `--spec`, or from the opposite side
 *   when that side named a file.
 *
 * IT IS A PURE FUNCTION OVER AN INJECTED `exists`, so the whole table above is testable without
 * a repository, a checkout or a disk. The half that needs git is `git-ref.adapter.ts`.
 */

/** One side, classified. */
export type DiffSide =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'ref'; readonly ref: string; readonly path: string | undefined };

/** What resolving both sides produced. */
export type DiffSides =
  | { readonly ok: true; readonly older: DocumentSource; readonly newer: DocumentSource }
  | { readonly ok: false; readonly usageError: string };

/** What `resolveDiffSides` needs from the world. */
export interface DiffSideEnvironment {
  /** Whether a path names something that is there. */
  readonly exists: (path: string) => boolean;
  /** `--spec`, when the caller gave one. */
  readonly spec?: string | undefined;
  /** Where git runs and what a relative path is resolved against. */
  readonly cwd?: string | undefined;
}

/**
 * Classifies one side without deciding what path a bare ref carries.
 *
 * @param value - The argument as typed
 * @param exists - Whether a path is on the disk
 * @returns The classification
 */
export function classifyDiffSide(value: string, exists: (path: string) => boolean): DiffSide {
  if (exists(value)) return { kind: 'file', path: value };

  // GIT SPLITS `<rev>:<path>` AT THE FIRST COLON AND SO DOES THIS. A ref may hold slashes,
  // `origin/main` being the ordinary case, so splitting at the last colon would read
  // `origin/main:a:b` as the ref `origin/main:a`, which is not what git would do with it.
  const colon = value.indexOf(':');
  if (colon > 0 && colon < value.length - 1) {
    return { kind: 'ref', ref: value.slice(0, colon), path: value.slice(colon + 1) };
  }

  return { kind: 'ref', ref: value, path: undefined };
}

/**
 * Resolves both sides of a diff into two document sources.
 *
 * @param older - The `<old>` argument
 * @param newer - The `<new>` argument
 * @param environment - The disk, `--spec`, and where git runs
 * @returns Both sources, or the one usage error that stopped it
 */
export function resolveDiffSides(
  older: string,
  newer: string,
  environment: DiffSideEnvironment,
): DiffSides {
  const left = classifyDiffSide(older, environment.exists);
  const right = classifyDiffSide(newer, environment.exists);

  const borrowed =
    environment.spec ??
    (left.kind === 'file' ? left.path : undefined) ??
    (right.kind === 'file' ? right.path : undefined);

  const sources: DocumentSource[] = [];
  for (const [side, label] of [
    [left, '<old>'],
    [right, '<new>'],
  ] as const) {
    if (side.kind === 'file') {
      sources.push({ kind: 'spec', path: side.path });
      continue;
    }

    const path = side.path ?? borrowed;
    if (path === undefined) {
      return {
        ok: false,
        usageError:
          `${label} "${side.ref}" is not a file on disk, so it is read as a git ref, and nothing ` +
          'says which file to read at it. Give --spec <path>, write the side as <ref>:<path>, or ' +
          'name a file that exists',
      };
    }

    const refusal =
      refusedGitArgument(side.ref, `${label} as a git ref`) ??
      refusedGitArgument(path, `the path under ${label}`);
    if (refusal !== undefined) return { ok: false, usageError: refusal };

    sources.push({
      kind: 'git',
      ref: side.ref,
      path,
      ...(environment.cwd === undefined ? {} : { cwd: environment.cwd }),
    });
  }

  const [olderSource, newerSource] = sources;
  if (olderSource === undefined || newerSource === undefined) {
    return { ok: false, usageError: 'two spec paths or git refs are required, <old> <new>' };
  }

  return { ok: true, older: olderSource, newer: newerSource };
}
