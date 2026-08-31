import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InvalidOptionsError } from '@openref/core';
import { PublicDirStore } from '../../src/index';

/**
 * The directory with two writers, and what happens where they meet.
 *
 * ON A REAL DISK BECAUSE THE SUBJECT IS A DISK. The whole question is what an existing directory
 * entry does to a write, and a store in memory answers a different question.
 */

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openref-public-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('PublicDirStore', () => {
  it('should refuse to overwrite a file no openref build wrote, naming it', async () => {
    // Given
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'index.html'), 'somebody else', 'utf8');
    const store = new PublicDirStore({
      root,
      mount: 'docs',
      ownedFiles: [],
      withheldFile: null,
    });

    // When
    const refusal = store.write('index.html', '<!doctype html>');

    // Then
    await expect(refusal).rejects.toThrow(InvalidOptionsError);
    await expect(refusal).rejects.toThrow(/already exists in the Nuxt public directory/);
    expect(await readFile(join(root, 'docs', 'index.html'), 'utf8')).toBe('somebody else');
  });

  it('should overwrite a file the previous manifest claimed, which is what a rebuild does', async () => {
    // Given
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'index.html'), 'the previous build', 'utf8');
    const store = new PublicDirStore({
      root,
      mount: 'docs',
      ownedFiles: ['index.html'],
      withheldFile: null,
    });

    // When
    await store.write('index.html', 'this build');

    // Then
    expect(await readFile(join(root, 'docs', 'index.html'), 'utf8')).toBe('this build');
  });

  it('should keep the withheld server source out of the published directory and hand it back', async () => {
    // Given
    const file = 'server/routes/docs/_proxy/[...].ts';
    const store = new PublicDirStore({
      root,
      mount: 'docs',
      ownedFiles: [],
      withheldFile: file,
    });

    // Then: nothing has been withheld before the build offers it.
    expect(store.withheld).toBeNull();

    // When
    await store.write(file, 'export default defineEventHandler(() => undefined);');
    await store.write('index.html', '<!doctype html>');

    // Then
    expect(store.withheld).toBe('export default defineEventHandler(() => undefined);');
    await expect(readFile(join(root, 'docs', file), 'utf8')).rejects.toThrow(/ENOENT/);
    expect(await readFile(join(root, 'docs', 'index.html'), 'utf8')).toBe('<!doctype html>');
  });

  it('should write bytes and read back what it wrote, which is what the incremental path needs', async () => {
    // Given
    const store = new PublicDirStore({
      root,
      mount: 'docs',
      ownedFiles: [],
      withheldFile: null,
    });

    // When
    await store.writeBytes('_assets/theme.css', new TextEncoder().encode('.oref-body{}'));
    await store.write('llms.txt', '# Parcels');

    // Then
    expect(await store.read('llms.txt')).toBe('# Parcels');
    expect(await readFile(join(root, 'docs', '_assets', 'theme.css'), 'utf8')).toBe('.oref-body{}');
  });

  it('should let this build rewrite what this build already wrote', async () => {
    // Given
    const store = new PublicDirStore({
      root,
      mount: 'docs',
      ownedFiles: [],
      withheldFile: null,
    });
    await store.write('llms.txt', 'first');

    // When
    await store.write('llms.txt', 'second');

    // Then
    expect(await store.read('llms.txt')).toBe('second');
  });
});
