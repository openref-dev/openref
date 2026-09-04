import { execFileSync } from 'node:child_process';
import { globSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
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

      // When
      const everything = prettierFileList(['.'], emptyIgnore());
      const allowed = prettierFileList(pathsOf(scripts()['format:check'] ?? ''), emptyIgnore());

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

      // When, the identical scan the case above ran, answered from the cache rather than by
      // spawning prettier over the whole allowlist a second time
      const allowed = prettierFileList(pathsOf(scripts()['format:check'] ?? ''), emptyIgnore());

      // Then, BUILD.md addresses tasks by absolute line number and prettier reflows markdown
      expect(allowed.some((file) => file.includes('ai-docs/'))).toBe(false);
      expect(allowed.some((file) => file.endsWith('CLAUDE.md'))).toBe(false);
      expect(allowed.some((file) => file.endsWith('pnpm-lock.yaml'))).toBe(false);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  /**
   * The partition, which is the property this suite deliberately did not hold until `T065`.
   *
   * THE ALLOWLIST FAILS CLOSED AND THAT IS THE DEFECT HERE RATHER THAN THE PROTECTION. Until
   * `T065` the only markdown pattern under `packages/` was `packages/*&#47;README.md`, so
   * `packages/vue/PUBLIC-API.md`, `packages/theme-telltale/THEME-BOUNDARY.md` and
   * `packages/nest/DISTRIBUTION.md` were left alone, and measured, all three were unformatted.
   * Nothing asserted that a markdown file under `packages/` is either on the list or deliberately
   * off it, so a new one arrived silently on whichever side it landed. This case asserts the
   * partition, so a `packages/<name>/SOMETHING.md` fails until somebody decides which side it is
   * on, and the two deliberate exclusions carry their reason here.
   */
  it(
    'should put every markdown file under packages on one side of the list or the other',
    () => {
      // Given, every markdown file in the workspace's packages, however deep.
      const found = execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', 'packages/**/*.md'],
        { cwd: repoRoot, encoding: 'utf8' },
      )
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      // WHAT THE LIST REACHES, EXPANDED FROM THE SCRIPT'S OWN PATTERNS. `--list-different` cannot
      // answer this: it names the files prettier would change, so a list that reached a file and
      // found it already formatted is indistinguishable from a list that never reached it.
      const listed = new Set(
        pathsOf(scripts()['format:check'] ?? '').flatMap((pattern) =>
          globSync(pattern, { cwd: repoRoot }).map((file) => file.split(sep).join('/')),
        ),
      );

      // DELIBERATELY OFF, EACH WITH ITS REASON. The corpus is vendored upstream text and
      // generated snapshots, and reformatting either would rewrite somebody else's document or a
      // recorded reading; the font notices are licence text that a reflow would alter.
      const deliberatelyOff = (file: string): boolean =>
        file.startsWith('packages/core/test/') || /^packages\/[^/]+\/fonts\//.test(file);

      // When
      const unaccounted = found.filter((file) => !listed.has(file) && !deliberatelyOff(file));

      // Then, the subject is present on both sides, so neither half can pass by being empty.
      expect(found.length).toBeGreaterThan(10);
      expect(found.some((file) => deliberatelyOff(file))).toBe(true);
      expect(found.some((file) => listed.has(file))).toBe(true);
      expect(unaccounted).toEqual([]);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

/** One empty ignore file for the whole suite, written on first use. */
let emptyIgnorePath = '';

/**
 * An ignore file with nothing in it, so only the allowlist is doing any work.
 *
 * @returns Path to the file
 */
function emptyIgnore(): string {
  if (emptyIgnorePath === '') {
    emptyIgnorePath = join(mkdtempSync(join(tmpdir(), 'oref-fmt-')), 'ignore');
    writeFileSync(emptyIgnorePath, '', 'utf8');
  }

  return emptyIgnorePath;
}

/** Every scan already run, keyed by the patterns and the ignore file they were run with. */
const scans = new Map<string, string[]>();

/**
 * Files prettier would act on for a set of patterns, one per line.
 *
 * ANSWERED ONCE PER QUESTION. Two cases below ask prettier the identical question, the allowlist
 * against an empty ignore file, and each used to spawn its own prettier over the whole list. On the
 * runner that is one of the more expensive things this suite does, and the second answer was never
 * going to differ from the first: same patterns, same ignore file, same tree, no case here writes
 * to any of them.
 *
 * IT DOES NOT MAKE THE CASE THAT IS OVER ITS BOUND ANY CHEAPER, and it is not offered as if it
 * did. `should hold the corpus out on its own` asks this question first and pays for it in full,
 * plus a scan of the whole repository that dominates it. What that costs, and what could be done
 * about it, is measured and left to the maintainer rather than settled here.
 *
 * @param patterns - Path patterns, as the format script writes them
 * @param ignorePath - The ignore file to run against
 * @returns The files prettier reports as different, one per entry
 */
function prettierFileList(patterns: readonly string[], ignorePath: string): string[] {
  const key = JSON.stringify([ignorePath, ...patterns]);
  const cached = scans.get(key);
  if (cached !== undefined) return cached;

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

  const listed = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  scans.set(key, listed);

  return listed;
}
