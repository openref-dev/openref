/**
 * The output store backed by the filesystem.
 *
 * EVERY PATH IS RESOLVED AND THEN CHECKED AGAINST THE ROOT, which is not ceremony: the segments
 * come from ids in a document this project did not write, and `pathSegmentOf` escapes the
 * separators exactly so that they cannot become path structure. This is the second half of that
 * property, enforced where the write happens, so a future caller that builds a path some other
 * way still cannot leave the directory.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { ErrorCode, InvalidOptionsError } from '@openref/core';
import type { IOutputStore } from '../../application/ports/output-store.port';

/** Writes a build to a directory. */
export class FsOutputStore implements IOutputStore {
  private readonly root: string;

  /** @param root - Output directory, absolute or relative to the process */
  constructor(root: string) {
    this.root = resolve(root);
  }

  /** @inheritdoc */
  async read(path: string): Promise<string | null> {
    try {
      return await readFile(this.resolveInside(path), 'utf8');
    } catch {
      return null;
    }
  }

  /** @inheritdoc */
  async write(path: string, contents: string): Promise<void> {
    const target = this.resolveInside(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, 'utf8');
  }

  /** @inheritdoc */
  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    const target = this.resolveInside(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  /** @inheritdoc */
  async remove(path: string): Promise<void> {
    await rm(this.resolveInside(path), { force: true });
  }

  /**
   * The absolute path of one entry, refusing anything outside the root.
   *
   * @param path - Path relative to the output root, forward slashes
   * @returns The absolute path
   * @throws {InvalidOptionsError} When the path would leave the output directory
   */
  private resolveInside(path: string): string {
    const target = resolve(join(this.root, ...path.split('/')));
    const inside = relative(this.root, target);

    if (inside === '' || inside.startsWith('..') || inside.startsWith(`..${sep}`)) {
      throw new InvalidOptionsError(
        `the static build refused to touch "${path}", which is outside the output directory`,
        ErrorCode.CONFIG_INVALID_OPTIONS,
        undefined,
        { path },
      );
    }

    return target;
  }
}
