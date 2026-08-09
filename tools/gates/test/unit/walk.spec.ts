import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectFiles } from '../../src/lib/walk';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'openref-walk-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('collectFiles', () => {
  it('should collect matching files from nested directories in sorted order', () => {
    // Given
    mkdirSync(join(root, 'dist', 'nested'), { recursive: true });
    writeFileSync(join(root, 'dist', 'b.js'), '');
    writeFileSync(join(root, 'dist', 'nested', 'a.js'), '');
    writeFileSync(join(root, 'dist', 'skip.txt'), '');

    // When
    const files = collectFiles(join(root, 'dist'), ['.js'], root);

    // Then
    expect(files).toEqual(['dist/b.js', 'dist/nested/a.js']);
  });

  it('should return an empty list for a directory that does not exist', () => {
    // Given
    const missing = join(root, 'never-built');

    // When
    const files = collectFiles(missing, ['.js'], root);

    // Then
    expect(files).toEqual([]);
  });

  it('should match extensions case insensitively', () => {
    // Given
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist', 'STYLE.CSS'), '');

    // When
    const files = collectFiles(join(root, 'dist'), ['.css'], root);

    // Then
    expect(files).toEqual(['dist/STYLE.CSS']);
  });
});
