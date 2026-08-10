import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Finds the repository root by walking up from this file.
 *
 * Computed rather than counted, because this package is read from `src` by the test suite and
 * from `dist` by the gate, and those sit at different depths. A relative count would be right
 * in one and quietly wrong in the other, and quietly wrong here means measuring a document
 * that was never loaded.
 *
 * @param from - Directory to start from
 * @returns The absolute repository root
 * @throws Error when no ancestor carries the workspace file
 */
export function repositoryRoot(from: string = import.meta.dirname): string {
  let directory = resolve(from);

  for (;;) {
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) return directory;

    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`no pnpm-workspace.yaml above ${from}`);
    }
    directory = parent;
  }
}
