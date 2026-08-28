import { exec } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InvalidOptionsError } from '@openref/core';
import { FsOutputStore } from '../../src/index';

/**
 * The output store against a hostile directory, per the `T043` adversarial pass.
 *
 * A REAL FILESYSTEM, BECAUSE THE DEFECT WAS THE DIFFERENCE BETWEEN A PATH AND AN ENTRY. The
 * store's check resolved the spelling of a path and answered correctly that it was inside the
 * root; `writeFile` and `rm` then followed a symbolic link planted in the root and landed
 * outside it. Nothing in memory can show that, so this suite writes to a temporary directory and
 * checks a file that is not in it.
 *
 * THE VICTIM IS ASSERTED TO EXIST BEFORE EACH CASE, so a case that passes because the store
 * refused is told apart from one that passes because there was nothing to reach.
 */
describe('FsOutputStore, a symbolic link planted in the output directory', () => {
  let root = '';
  let outside = '';
  let victim = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'openref-store-'));
    outside = join(root, 'outside');
    await mkdir(join(root, 'out'), { recursive: true });
    await mkdir(outside, { recursive: true });
    victim = join(outside, 'index.html');
    await writeFile(victim, 'ORIGINAL', 'utf8');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('should refuse to write through a link that stands where a directory is expected', async () => {
    // Given
    await symlink(outside, join(root, 'out', 'health'));
    const store = new FsOutputStore(join(root, 'out'));
    expect(await readFile(victim, 'utf8')).toBe('ORIGINAL');

    // When
    const attempt = store.write('health/index.html', 'REPLACED');

    // Then
    await expect(attempt).rejects.toBeInstanceOf(InvalidOptionsError);
    expect(await readFile(victim, 'utf8')).toBe('ORIGINAL');
  });

  it('should refuse to write a leaf that is itself a link', async () => {
    // Given
    await symlink(victim, join(root, 'out', 'llms.txt'));
    const store = new FsOutputStore(join(root, 'out'));
    expect(await readFile(victim, 'utf8')).toBe('ORIGINAL');

    // When
    const attempt = store.write('llms.txt', 'REPLACED');

    // Then
    await expect(attempt).rejects.toBeInstanceOf(InvalidOptionsError);
    expect(await readFile(victim, 'utf8')).toBe('ORIGINAL');
  });

  it('should refuse to remove through a link that stands where a directory is expected', async () => {
    // Given: the stale file removal of SPEC 16.3, aimed through a planted link.
    await symlink(outside, join(root, 'out', 'schema'));
    const store = new FsOutputStore(join(root, 'out'));
    expect(await readFile(victim, 'utf8')).toBe('ORIGINAL');

    // When
    const attempt = store.remove('schema/index.html');

    // Then
    await expect(attempt).rejects.toBeInstanceOf(InvalidOptionsError);
    expect(await readFile(victim, 'utf8')).toBe('ORIGINAL');
  });

  it('should refuse to write an entry that is a second name for a file outside the root', async () => {
    // Given: a HARD link, which has no target to not follow, so `O_NOFOLLOW` and the `lstat`
    // walk both see an ordinary file. Driven: this replaced the victim with build bytes.
    const { link } = await import('node:fs/promises');
    await link(victim, join(root, 'out', 'llms.txt'));
    const store = new FsOutputStore(join(root, 'out'));
    expect(await readFile(victim, 'utf8')).toBe('ORIGINAL');

    // When
    const attempt = store.write('llms.txt', 'REPLACED');

    // Then
    await expect(attempt).rejects.toBeInstanceOf(InvalidOptionsError);
    await expect(attempt).rejects.toThrow(/second name/);
    expect(await readFile(victim, 'utf8')).toBe('ORIGINAL');
  });

  it.each([
    ['a named pipe, whose open blocks forever', 'fifo'],
    ['a directory where a file belongs', 'directory'],
  ])('should refuse %s rather than hang or report an errno', async (_reason, kind) => {
    // Given: `O_NOFOLLOW` declines a symbolic link and nothing else, so a build met a pipe at a
    // page path and blocked with no output at all until it was killed.

    const path = join(root, 'out', 'llms.txt');
    if (kind === 'directory') {
      await mkdir(path, { recursive: true });
    } else {
      await new Promise<void>((made, failed) => {
        exec(`mkfifo ${JSON.stringify(path)}`, (error) => {
          if (error === null) {
            made();
            return;
          }
          failed(error);
        });
      });
    }
    const store = new FsOutputStore(join(root, 'out'));

    // When
    const attempt = store.write('llms.txt', 'PAGE');

    // Then: refused, by name, rather than blocked.
    await expect(attempt).rejects.toBeInstanceOf(InvalidOptionsError);
    await expect(attempt).rejects.toThrow(/rather than a regular file/);
  });

  it('should rewrite a file it wrote itself, so the second name rule spares an ordinary rebuild', async () => {
    // Given: the incremental path of SPEC 16.3 rewrites the previous build's own pages.
    const store = new FsOutputStore(join(root, 'out'));
    await store.write('get-a/index.html', 'FIRST');

    // When
    await store.write('get-a/index.html', 'SECOND');

    // Then
    expect(await store.read('get-a/index.html')).toBe('SECOND');
  });

  it('should read, write and remove an ordinary file, so the guard is not a refusal of everything', async () => {
    // Given
    const store = new FsOutputStore(join(root, 'out'));

    // When
    await store.write('schema/User/index.html', 'PAGE');
    const read = await store.read('schema/User/index.html');
    await store.remove('schema/User/index.html');

    // Then
    expect(read).toBe('PAGE');
    expect(await store.read('schema/User/index.html')).toBeNull();
  });

  it('should refuse a path that leaves the root by spelling alone, as it always did', async () => {
    // Given
    const store = new FsOutputStore(join(root, 'out'));

    // When
    const attempt = store.write('../../escape.txt', 'REPLACED');

    // Then
    await expect(attempt).rejects.toBeInstanceOf(InvalidOptionsError);
  });
});
