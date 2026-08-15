import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countCommitsSince } from '../../src/lib/git';

/**
 * A scratch repository with three commits: one touching `packages/`, one touching only
 * `ai-docs/`, and one touching `packages/` again. The distance the freshness check asks about
 * is "commits touching the measured page's inputs", so the doc-only commit must not count.
 */
const root = mkdtempSync(join(tmpdir(), 'oref-git-spec-'));
let first = '';
let last = '';

function git(...args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=spec',
      '-c',
      'user.email=spec@localhost',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: root, encoding: 'utf8' },
  ).trim();
}

function commitFile(relative: string, message: string): string {
  const absolute = join(root, relative);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, message);
  git('add', '.');
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
}

beforeAll(() => {
  git('init', '-q');
  first = commitFile('packages/core.txt', 'product work');
  commitFile('ai-docs/NOTES.txt', 'doc only work');
  last = commitFile('packages/render.txt', 'more product work');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('countCommitsSince', () => {
  it('should count only the commits that touch the named paths', () => {
    // Given three commits past none, two past the first, and one of those two touching only
    // ai-docs, which is not an input of the measured page
    // When
    const distance = countCommitsSince(root, first, ['packages']);

    // Then
    expect(distance.count).toBe(1);
    expect(distance.reason).toBeUndefined();
  });

  it('should count zero when the record is at HEAD', () => {
    // Given
    // When
    const distance = countCommitsSince(root, last, ['packages']);

    // Then
    expect(distance.count).toBe(0);
  });

  it('should answer null with a reason for a commit the history does not hold', () => {
    // Given a shallow clone or a rewritten history. Null and zero are different answers: zero
    // says the record is current, null says the question could not be asked, and folding the
    // second into the first would let a record claim freshness with no evidence.
    // When
    const distance = countCommitsSince(root, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', [
      'packages',
    ]);

    // Then
    expect(distance.count).toBeNull();
    expect(distance.reason).toBeTruthy();
  });

  it('should answer null with a reason outside a repository', () => {
    // Given
    const outside = mkdtempSync(join(tmpdir(), 'oref-git-spec-outside-'));

    try {
      // When
      const distance = countCommitsSince(outside, 'deadbeef', ['packages']);

      // Then
      expect(distance.count).toBeNull();
      expect(distance.reason).toBeTruthy();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
