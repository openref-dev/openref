import { describe, expect, it } from 'vitest';
import { classifyDiffSide, resolveDiffSides } from '../../src/cli/domain/diff-side';

/**
 * The resolution table of SPEC 17.1 as amended by T041, over an injected disk.
 *
 * NOTHING HERE TOUCHES A REPOSITORY OR A FILE. `exists` is a function, so every row of the table
 * is stated as a row rather than as a fixture, including the two rows a real disk cannot easily
 * produce: a branch and a file with the same name, and a side that is neither.
 */

const nothingExists = (): boolean => false;
const everythingExists = (): boolean => true;

describe('classifyDiffSide', () => {
  it('should call a side that is on the disk a file, even when a branch shares its name', () => {
    // Given a disk where "main" is a real file
    const exists = (path: string): boolean => path === 'main';

    // When
    const side = classifyDiffSide('main', exists);

    // Then
    expect(side).toEqual({ kind: 'file', path: 'main' });
  });

  it('should split <ref>:<path> at the first colon, so a ref may hold slashes', () => {
    // Given
    const value = 'origin/release/2.0:api/openapi.yaml';

    // When
    const side = classifyDiffSide(value, nothingExists);

    // Then
    expect(side).toEqual({
      kind: 'ref',
      ref: 'origin/release/2.0',
      path: 'api/openapi.yaml',
    });
  });

  it('should call a bare side a ref with no path of its own', () => {
    // When
    const side = classifyDiffSide('v1.4.0', nothingExists);

    // Then
    expect(side).toEqual({ kind: 'ref', ref: 'v1.4.0', path: undefined });
  });

  it('should not read a trailing colon as an empty path', () => {
    // When
    const side = classifyDiffSide('main:', nothingExists);

    // Then
    expect(side).toEqual({ kind: 'ref', ref: 'main:', path: undefined });
  });
});

describe('resolveDiffSides', () => {
  it('should resolve the SPEC 17.1 transcript, two branch names plus --spec', () => {
    // Given: `openref diff main current --spec openapi.json`, neither side on the disk
    // When
    const sides = resolveDiffSides('main', 'current', {
      exists: nothingExists,
      spec: 'openapi.json',
    });

    // Then
    expect(sides).toEqual({
      ok: true,
      older: { kind: 'git', ref: 'main', path: 'openapi.json' },
      newer: { kind: 'git', ref: 'current', path: 'openapi.json' },
    });
  });

  it('should let a bare ref borrow the path from the side that named a file', () => {
    // Given: `openref diff main openapi.json`, only the second on the disk
    const exists = (path: string): boolean => path === 'openapi.json';

    // When
    const sides = resolveDiffSides('main', 'openapi.json', { exists });

    // Then
    expect(sides).toEqual({
      ok: true,
      older: { kind: 'git', ref: 'main', path: 'openapi.json' },
      newer: { kind: 'spec', path: 'openapi.json' },
    });
  });

  it('should keep two file sides as files, which is what T038 shipped', () => {
    // When
    const sides = resolveDiffSides('old.json', 'new.json', { exists: everythingExists });

    // Then
    expect(sides).toEqual({
      ok: true,
      older: { kind: 'spec', path: 'old.json' },
      newer: { kind: 'spec', path: 'new.json' },
    });
  });

  it('should prefer --spec over a path borrowed from the other side', () => {
    // Given both a file side and an explicit --spec, which disagree
    const exists = (path: string): boolean => path === 'other.json';

    // When
    const sides = resolveDiffSides('main', 'other.json', { exists, spec: 'chosen.json' });

    // Then
    expect(sides).toMatchObject({
      ok: true,
      older: { kind: 'git', ref: 'main', path: 'chosen.json' },
    });
  });

  it('should refuse a bare ref with no path to read at it, and name the three ways out', () => {
    // When
    const sides = resolveDiffSides('main', 'topic', { exists: nothingExists });

    // Then
    expect(sides.ok).toBe(false);
    expect(sides.ok ? '' : sides.usageError).toContain('--spec');
    expect(sides.ok ? '' : sides.usageError).toContain('<ref>:<path>');
  });

  it('should refuse a ref that starts with a hyphen before git could read it as an option', () => {
    // When
    const sides = resolveDiffSides('--upload-pack=touch', 'main', {
      exists: nothingExists,
      spec: 'openapi.json',
    });

    // Then
    expect(sides.ok).toBe(false);
    expect(sides.ok ? '' : sides.usageError).toContain('git would read as an option');
  });

  it('should refuse a borrowed path that starts with a hyphen', () => {
    // When
    const sides = resolveDiffSides('main', 'topic', {
      exists: nothingExists,
      spec: '-o/tmp/pwned',
    });

    // Then
    expect(sides.ok).toBe(false);
    expect(sides.ok ? '' : sides.usageError).toContain('git would read as an option');
  });

  it('should carry the working directory onto every git side and onto no file side', () => {
    // Given
    const exists = (path: string): boolean => path === 'new.json';

    // When
    const sides = resolveDiffSides('main', 'new.json', { exists, cwd: '/repo' });

    // Then
    expect(sides).toEqual({
      ok: true,
      older: { kind: 'git', ref: 'main', path: 'new.json', cwd: '/repo' },
      newer: { kind: 'spec', path: 'new.json' },
    });
  });
});
