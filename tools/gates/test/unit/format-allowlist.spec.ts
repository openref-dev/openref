import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * `pnpm format` takes an allowlist, not an ignore list.
 *
 * Prettier has twice rewritten content it had no business touching, `CLAUDE.md` and then
 * the vendored corpus, and both times `.prettierignore` was extended after the damage. An
 * ignore list fails open: anything nobody thought of is formatted. An allowlist fails
 * closed: anything nobody thought of is left alone.
 *
 * These tests hold the shape of that list rather than its exact contents, so adding a real
 * source directory is one edit and does not have to be made twice.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

interface PackageJson {
  readonly scripts: Readonly<Record<string, string>>;
}

function scripts(): Readonly<Record<string, string>> {
  return (JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as PackageJson)
    .scripts;
}

/** The quoted path arguments of a prettier invocation, in order. */
function pathsOf(script: string): string[] {
  return [...script.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? '');
}

describe('the format allowlist', () => {
  it('should name explicit paths rather than the whole repository', () => {
    // Given
    const format = scripts().format ?? '';

    // When
    const paths = pathsOf(format);

    // Then
    expect(paths.length).toBeGreaterThan(0);
    expect(format).not.toMatch(/prettier --write \.\s*$/);
  });

  it('should give format and format:check the same list, so they cannot disagree', () => {
    // Given
    const all = scripts();

    // When
    const write = pathsOf(all.format ?? '');
    const check = pathsOf(all['format:check'] ?? '');

    // Then
    expect(write).toEqual(check);
  });

  it('should differ from each other only in the prettier mode flag', () => {
    // Given
    const all = scripts();

    // When
    const normalized = [all.format ?? '', all['format:check'] ?? ''].map((script) =>
      script.replace('--write', '--MODE').replace('--check', '--MODE'),
    );

    // Then
    expect(normalized[0]).toBe(normalized[1]);
  });

  it(
    'should reach no vendored corpus document, whatever the ignore file says',
    () => {
      // Given, prettier reports the files it would actually act on
      const script = scripts()['format:check'] ?? '';
      const paths = pathsOf(script);

      // When
      let listed: string;
      try {
        listed = execFileSync(
          'pnpm',
          ['exec', 'prettier', '--list-different', '--no-error-on-unmatched-pattern', ...paths],
          { cwd: repoRoot, encoding: 'utf8' },
        );
      } catch (error) {
        // A non zero exit only means some file is unformatted, which is not what is asked here.
        listed = (error as { stdout?: string }).stdout ?? '';
      }

      // Then
      expect(listed).not.toContain('test/corpus/documents');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should hold the corpus out on its own, with the ignore file taken away',
    () => {
      // Given, an empty ignore file, so only the allowlist is doing any work. This is the
      // property under test: .prettierignore already excludes the corpus, and an ignore list
      // that happens to be right today is exactly what failed twice before.
      const emptyIgnore = join(mkdtempSync(join(tmpdir(), 'oref-fmt-')), 'ignore');
      writeFileSync(emptyIgnore, '', 'utf8');

      // When
      const everything = prettierFileList(['.'], emptyIgnore);
      const allowed = prettierFileList(pathsOf(scripts()['format:check'] ?? ''), emptyIgnore);

      // Then, prettier reaches the corpus when nothing but the allowlist stands in its way,
      // and the allowlist is what keeps it out
      expect(everything.some((file) => file.includes('test/corpus/documents'))).toBe(true);
      expect(allowed.some((file) => file.includes('test/corpus/documents'))).toBe(false);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should leave the specification and the instructions alone without the ignore file',
    () => {
      // Given
      const emptyIgnore = join(mkdtempSync(join(tmpdir(), 'oref-fmt-')), 'ignore');
      writeFileSync(emptyIgnore, '', 'utf8');

      // When
      const allowed = prettierFileList(pathsOf(scripts()['format:check'] ?? ''), emptyIgnore);

      // Then, BUILD.md addresses tasks by absolute line number and prettier reflows markdown
      expect(allowed.some((file) => file.includes('ai-docs/'))).toBe(false);
      expect(allowed.some((file) => file.endsWith('CLAUDE.md'))).toBe(false);
      expect(allowed.some((file) => file.endsWith('pnpm-lock.yaml'))).toBe(false);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

/** Files prettier would act on for a set of patterns, one per line. */
function prettierFileList(patterns: readonly string[], ignorePath: string): string[] {
  let output: string;
  try {
    output = execFileSync(
      'pnpm',
      [
        'exec',
        'prettier',
        '--list-different',
        '--no-error-on-unmatched-pattern',
        '--ignore-path',
        ignorePath,
        ...patterns,
      ],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    output = (error as { stdout?: string }).stdout ?? '';
  }

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
