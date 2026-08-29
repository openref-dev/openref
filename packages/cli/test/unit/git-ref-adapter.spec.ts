import { UsageError } from '@openref/core';
import { describe, expect, it } from 'vitest';
import {
  loadGitDocument,
  readGitBlob,
} from '../../src/cli/infrastructure/adapters/git-ref.adapter';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * Reading a file out of a revision, against this repository, which is one.
 *
 * THE GUARD IS TESTED HERE AND NOT ONLY AT THE CALL SITE. `resolveDiffSides` refuses a leading
 * hyphen before it decides anything, so this one can only fire when something else calls in, and
 * a second line of defence that has never been fired is indistinguishable from a missing one.
 */

describe('readGitBlob', () => {
  it(
    'should read a committed file at HEAD',
    async () => {
      // Given: this repository, at its own HEAD
      // When
      const text = await readGitBlob('HEAD', 'package.json');

      // Then
      expect(text).toContain('"name": "openref-monorepo"');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should refuse a ref that starts with a hyphen before spawning git',
    async () => {
      // When
      const failing = readGitBlob('--upload-pack=touch /tmp/x', 'package.json');

      // Then
      await expect(failing).rejects.toBeInstanceOf(UsageError);
      await expect(failing).rejects.toThrow('git would read as an option');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should refuse a path that starts with a hyphen',
    async () => {
      // When / Then
      await expect(readGitBlob('HEAD', '-o/tmp/x')).rejects.toThrow('git would read as an option');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should report a ref that does not resolve as a usage error naming both sides',
    async () => {
      // When
      const failing = readGitBlob('no-such-ref-anywhere', 'package.json');

      // Then
      await expect(failing).rejects.toBeInstanceOf(UsageError);
      await expect(failing).rejects.toThrow(
        'could not read package.json at git ref no-such-ref-anywhere',
      );
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should report a file that is not in the revision rather than answer an empty document',
    async () => {
      // When / Then
      await expect(readGitBlob('HEAD', 'no-such-file-in-this-tree.json')).rejects.toThrow(
        'could not read no-such-file-in-this-tree.json at git ref HEAD',
      );
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('loadGitDocument', () => {
  it(
    'should normalize what git produced, and close without holding anything',
    async () => {
      // Given a document committed in this repository
      // When
      const loaded = await loadGitDocument('HEAD', 'packages/cli/test/mocks/mini-spec.json');

      // Then
      expect(loaded.document.info.title).not.toBe('');
      await expect(loaded.close()).resolves.toBeUndefined();
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});
