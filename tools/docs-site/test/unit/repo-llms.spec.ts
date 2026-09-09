import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT } from '../../src/index.js';
import { describedPackages, repoLlmsFull, repoLlmsIndex } from '../../src/repo-llms.js';

/**
 * The repository's own llms.txt and llms-full.txt, held to the packages they describe.
 *
 * THE COMMITTED COPY IS THE SUBJECT, NOT THE COMPOSER. A composer nobody writes to disk is a
 * green suite about a file that does not exist, and a written file nobody re-composes is a
 * package list going stale in a fifth place. So the fixed point case reads the two committed
 * files and fails, naming the command, the moment a manifest, a README or the composer moves
 * without `pnpm docs:build` running after it.
 */
describe('the repository described for a language model', () => {
  it('should describe every package of packages/, each exactly once', () => {
    // Given
    const directories = readdirSync(join(REPOSITORY_ROOT, 'packages'))
      .filter((entry) => existsSync(join(REPOSITORY_ROOT, 'packages', entry, 'package.json')))
      .sort();
    expect(directories.length).toBeGreaterThan(20);

    // When
    const described = describedPackages();
    const index = repoLlmsIndex();

    // Then
    expect(described.map((p) => p.directory)).toEqual(directories);
    for (const p of described) {
      const link = `](packages/${p.directory}/README.md)`;
      expect(index, `missing from the index: ${p.name}`).toContain(link);
      expect(index.indexOf(link)).toBe(index.lastIndexOf(link));
    }
  });

  it('should carry every README verbatim in the full text', () => {
    // Given
    const described = describedPackages();

    // When
    const full = repoLlmsFull();

    // Then
    for (const p of described) {
      expect(full, `missing from the full text: ${p.name}`).toContain(p.readme.trimEnd());
    }
  });

  it('should be current in the committed tree, or say what to run', () => {
    // Given the two files as they are committed
    const index = readFileSync(join(REPOSITORY_ROOT, 'llms.txt'), 'utf8');
    const full = readFileSync(join(REPOSITORY_ROOT, 'llms-full.txt'), 'utf8');

    // When, Then: byte identical to what the composer says today. When this fails, a manifest
    // or a README moved without the texts: run pnpm docs:build and commit the result.
    expect(index).toBe(repoLlmsIndex());
    expect(full).toBe(repoLlmsFull());
  });

  it('should carry no em dash and no en dash', () => {
    // Given, When
    const texts = [repoLlmsIndex(), repoLlmsFull()];

    // Then
    for (const text of texts) {
      expect(text.includes('\u2014')).toBe(false);
      expect(text.includes('\u2013')).toBe(false);
    }
  });
});
