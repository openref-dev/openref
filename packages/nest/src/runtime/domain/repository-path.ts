/**
 * Turning an absolute path on the build machine into a path a repository URL can hold.
 *
 * AN ABSOLUTE PATH MUST NEVER REACH THE IR, and that is a privacy rule as much as a correctness
 * one. `/Users/ada/work/acme-payments/packages/api/src/orders.controller.ts` names the person who
 * built the image, the machine they built it on, and an internal project name, and it would be
 * served to every reader of the documentation. What a link needs is
 * `packages/api/src/orders.controller.ts`, which is also the only form any forge accepts.
 *
 * A MONOREPO IS THE CASE THAT MAKES THIS WORTH A FILE. The repository root is not the package
 * root and not the working directory: a handler in `packages/api` is served by a process started
 * in `packages/api`, and its link has to carry the whole path from the root of the repository. So
 * the root is found by walking up to the `.git` that governs the file, per file, rather than
 * assumed from wherever the process happens to have started.
 *
 * PURE, AND THE FILE SYSTEM HALF LIVES NEXT DOOR in `infrastructure/adapters/repository.adapter.ts`.
 * This is the arithmetic on two paths; that is the walk that finds the second one.
 */

import { relative, sep } from 'node:path';

/**
 * Expresses one absolute path relative to a repository root.
 *
 * @param file - Absolute path of the file
 * @param root - Absolute path of the repository root
 * @returns The path from the root, with forward slashes, or undefined when the file is outside it
 */
export function repositoryRelative(file: string, root: string): string | undefined {
  if (file === '' || root === '') return undefined;

  const path = relative(root, file);

  // OUTSIDE THE ROOT IS REPORTED RATHER THAN LINKED, and `..` is how `relative` says so. A handler
  // in a linked dependency, or in a package outside the repository that the application imports,
  // has no position in this repository, and a link built from `../../other/thing.ts` would leave
  // the forge's own path and resolve to something arbitrary.
  if (path === '' || path.startsWith('..')) return undefined;

  // An absolute result means the two paths share no root at all, which Windows produces for two
  // different drives.
  if (path.startsWith(sep) || /^[A-Za-z]:/.test(path)) return undefined;

  return sep === '/' ? path : path.split(sep).join('/');
}
