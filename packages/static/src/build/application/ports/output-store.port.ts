/**
 * Where a build writes, as an interface rather than as `node:fs`.
 *
 * IT IS A PORT SO THE DETERMINISM TEST CAN COMPARE TWO BUILDS WITHOUT A DISK, and so the
 * incremental test can watch which files a rebuild touched rather than inferring it from
 * modification times, which have a resolution problem on some filesystems and say nothing about
 * why a file was written. The real adapter is `node:fs`, and the integration suite uses it.
 */

/** Where the build writes its files. */
export interface IOutputStore {
  /**
   * Reads a file this build wrote earlier, for the incremental path.
   *
   * @param path - Path relative to the output root, forward slashes
   * @returns The contents, or null when there is no such file
   */
  read(path: string): Promise<string | null>;

  /**
   * Writes one text file, creating whatever directories it needs.
   *
   * @param path - Path relative to the output root, forward slashes
   * @param contents - What to write
   */
  write(path: string, contents: string): Promise<void>;

  /**
   * Writes one binary file, creating whatever directories it needs.
   *
   * @param path - Path relative to the output root, forward slashes
   * @param bytes - What to write
   */
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;

  /**
   * Removes a file the previous build wrote and this one did not.
   *
   * A path this build never wrote and the previous manifest never named is never passed here:
   * a build owns what it wrote and nothing else in the directory.
   *
   * @param path - Path relative to the output root, forward slashes
   */
  remove(path: string): Promise<void>;
}
