/**
 * The output store backed by the filesystem.
 *
 * EVERY PATH IS RESOLVED AND THEN CHECKED AGAINST THE ROOT, which is not ceremony: the segments
 * come from ids in a document this project did not write, and `pathSegmentOf` escapes the
 * separators exactly so that they cannot become path structure. This is the second half of that
 * property, enforced where the write happens, so a future caller that builds a path some other
 * way still cannot leave the directory.
 *
 * AND THE LEXICAL CHECK IS NOT THE WHOLE PROPERTY, found by `T043`. `resolve` answers about the
 * spelling of a path; the kernel answers about the directory entries it names, and those two
 * disagree wherever one of the entries is a symbolic link. A link planted in the output
 * directory before the build, which is an ordinary thing for a checkout that a pull request can
 * write, made `writeFile` land outside the root and `rm` delete outside it, both while the check
 * above said the path was inside. So every directory on the way to an entry is verified with
 * `lstat` before it is used, missing ones are created rather than followed, and the entry itself
 * is opened with `O_NOFOLLOW`. The build refuses a link; it never rewrites the path around one,
 * because deciding where a deployer's link was meant to point is a decision nobody asked for.
 */

import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, rm } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { ErrorCode, InvalidOptionsError } from '@openref/core';
import type { IOutputStore } from '../../application/ports/output-store.port';

/**
 * What an entry is, in the words a refusal should use.
 *
 * @param entry - The result of `lstat`
 * @returns A noun phrase naming the kind
 */
function describeEntry(entry: {
  isDirectory(): boolean;
  isFIFO(): boolean;
  isSocket(): boolean;
  isSymbolicLink(): boolean;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
}): string {
  if (entry.isDirectory()) return 'a directory';
  if (entry.isFIFO()) return 'a named pipe';
  if (entry.isSocket()) return 'a socket';
  if (entry.isSymbolicLink()) return 'a symbolic link';
  if (entry.isBlockDevice() || entry.isCharacterDevice()) return 'a device node';
  return 'not a regular file';
}

/** Writes a build to a directory. */
export class FsOutputStore implements IOutputStore {
  private readonly root: string;

  /**
   * Directories under the root already proven to be real directories in this run.
   *
   * A BUILD WRITES THOUSANDS OF FILES INTO A HANDFUL OF DIRECTORIES, so without this the walk
   * below would `lstat` the same three entries once per page. The cache only ever holds entries
   * this store created or verified, so a link that appears mid build is still refused on the
   * first path that reaches it.
   */
  private readonly verified = new Set<string>();

  /** @param root - Output directory, absolute or relative to the process */
  constructor(root: string) {
    this.root = resolve(root);
  }

  /** @inheritdoc */
  async read(path: string): Promise<string | null> {
    try {
      const target = this.resolveInside(path);
      await this.verifyDirectories(path, { create: false });
      const handle = await open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      try {
        return await handle.readFile('utf8');
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof InvalidOptionsError) throw error;
      return null;
    }
  }

  /** @inheritdoc */
  async write(path: string, contents: string): Promise<void> {
    await this.writeBytes(path, Buffer.from(contents, 'utf8'));
  }

  /** @inheritdoc */
  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    const target = this.resolveInside(path);
    await this.verifyDirectories(path, { create: true });
    await this.refuseSecondName(path, target);

    // O_NOFOLLOW ON THE LEAF, so an existing entry that is a link is refused rather than written
    // through. The directories above it were proven by the walk; this is the last one.
    const handle = await open(
      target,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW,
    ).catch((cause: unknown) => {
      throw this.linkRefusal(path, cause);
    });

    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
  }

  /** @inheritdoc */
  async remove(path: string): Promise<void> {
    try {
      await this.verifyDirectories(path, { create: false });
    } catch (error) {
      if (error instanceof InvalidOptionsError) throw error;
      // A directory on the way is simply gone, so there is nothing at the path to remove.
      return;
    }

    // `rm` UNLINKS A LINK RATHER THAN FOLLOWING IT, so the leaf needs no guard of its own here;
    // it was the directories above it that made the previous version delete outside the root.
    await rm(this.resolveInside(path), { force: true });
  }

  /**
   * Walks the directories above one entry, refusing any that is not a real directory.
   *
   * @param path - Path relative to the output root, forward slashes
   * @param options - Whether a missing directory is created or is an absence to report
   * @throws {InvalidOptionsError} When a directory on the way is a symbolic link
   */
  private async verifyDirectories(path: string, options: { create: boolean }): Promise<void> {
    // THE ROOT ITSELF IS THE DEPLOYER'S OWN WORD. `--out` may be a link, may be anywhere, and
    // following it is what the flag asked for; the walk below is about what is INSIDE it.
    if (options.create && !this.verified.has(this.root)) {
      await mkdir(this.root, { recursive: true });
      this.verified.add(this.root);
    }

    const segments = path.split('/').slice(0, -1);
    let current = this.root;

    for (const segment of segments) {
      current = join(current, segment);
      if (this.verified.has(current)) continue;

      let entry: Awaited<ReturnType<typeof lstat>> | null = null;
      try {
        entry = await lstat(current);
      } catch {
        entry = null;
      }

      if (entry === null) {
        if (!options.create) throw new Error(`${current} does not exist`);
        await mkdir(current);
      } else if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new InvalidOptionsError(
          `the static build refused to write through "${relative(this.root, current)}", which is ` +
            'a symbolic link or is not a directory: a build never follows a link out of its own ' +
            'output directory',
          ErrorCode.CONFIG_INVALID_OPTIONS,
          undefined,
          { path, entry: current },
        );
      }

      this.verified.add(current);
    }
  }

  /**
   * Refuses an entry that is a second name for a file somewhere else.
   *
   * A HARD LINK HAS NO TARGET TO NOT FOLLOW, which is why `O_NOFOLLOW` and the `lstat` walk both
   * miss it: it is not a link to the file, it is the file, under another name. A link planted in
   * the output directory before the build is therefore written straight through, and review of
   * `T043`'s own fix drove exactly that, replacing a file outside `--out` with build bytes.
   *
   * THE QUESTION IS HOW MANY NAMES, not what kind of entry. A file this build wrote has one name;
   * so does a page left by the previous build, which the incremental path rewrites, so an ordinary
   * rebuild is untouched by this. Anything with a second name is a file something else can still
   * reach, and writing it would be writing there.
   *
   * @param path - Path relative to the output root, for the message
   * @param target - Its absolute path
   * @throws {InvalidOptionsError} When the entry already has more than one name
   */
  private async refuseSecondName(path: string, target: string): Promise<void> {
    let entry: Awaited<ReturnType<typeof lstat>>;
    try {
      entry = await lstat(target);
    } catch {
      return;
    }

    // WHAT IT IS, BEFORE HOW MANY NAMES IT HAS. `O_NOFOLLOW` declines a symbolic link and nothing
    // else, so a named pipe planted at a page path was opened and blocked forever: `T043`'s
    // verification measured a build that produced no output at all and had to be killed. A build
    // that hangs in silence is worse than one that fails, and a socket, a device node and a
    // directory where a file belongs are the same class of answer to the same question.
    if (!entry.isFile()) {
      throw new InvalidOptionsError(
        `the static build refused to write "${path}", which is ${describeEntry(entry)} rather ` +
          'than a regular file: a build writes files, and opening anything else here either ' +
          'blocks forever or writes somewhere it was not asked to',
        ErrorCode.CONFIG_INVALID_OPTIONS,
        undefined,
        { path },
      );
    }

    if (entry.nlink <= 1) return;

    throw new InvalidOptionsError(
      `the static build refused to write "${path}", which already has ${String(entry.nlink)} ` +
        'names: a hard link is a second name for a file somewhere else, and writing it would ' +
        'write outside the output directory',
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { path, nlink: entry.nlink },
    );
  }

  /**
   * The refusal a leaf that turned out to be a link deserves, or the original failure.
   *
   * `O_NOFOLLOW` REPORTS `ELOOP` ON LINUX AND ON MACOS, which is the one condition worth naming
   * differently from every other write failure: it is the attack, not the disk.
   */
  private linkRefusal(path: string, cause: unknown): unknown {
    const code = (cause as { code?: unknown }).code;
    if (code !== 'ELOOP') return cause;

    return new InvalidOptionsError(
      `the static build refused to write "${path}", which is a symbolic link: a build never ` +
        'follows a link out of its own output directory',
      ErrorCode.CONFIG_INVALID_OPTIONS,
      cause instanceof Error ? cause : undefined,
      { path },
    );
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
