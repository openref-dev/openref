import { execFileSync } from 'node:child_process';
import { existsSync, globSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFileInfo } from 'prettier';
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
 *
 * WHAT THIS FILE ASKS PRETTIER CHANGED ON 2026-09-04, ON THE MAINTAINER'S RULING, AND THE CHANGE
 * IS WORTH A READER'S ATTENTION BECAUSE IT IS A CHANGE OF INSTRUMENT AND NOT AN OPTIMISATION.
 * Until now every case here spawned `prettier --list-different`, which answers "which of these
 * files WOULD PRETTIER REWRITE". It now calls `prettier.getFileInfo` over the files the repository
 * holds, which answers "which of these files WOULD PRETTIER ACT ON". Those are different
 * questions, and the second is the one this file has always been about: an allowlist that reaches
 * a vendored document is a defect the moment it reaches it, whether or not that document happens
 * to be formatted the way prettier would write it today.
 *
 * THE DIFFERENCE IS MEASURABLE AND IT IS THREE DOCUMENTS. Over the empty ignore file,
 * `--list-different` names fourteen corpus documents and `getFileInfo` reaches seventeen. The three
 * `--list-different` cannot see, because they are already prettier formatted and so appear
 * identical to a document it never reached at all, are named here rather than left implied:
 *
 * - `packages/core/test/corpus/documents/oai-callback-example.yaml`
 * - `packages/core/test/corpus/documents/oai-non-oauth-scopes.yaml`
 * - `packages/core/test/corpus/documents/oai-webhook-example.yaml`
 *
 * That gap is exactly the defect the partition case at the bottom of this file already names in its
 * own comment, and it was living in these cases too. Three of seventeen is 18 percent of the
 * subject invisible to the instrument that was supposed to be watching it.
 *
 * SO THE COST FELL, WHICH IS WHY THE RULING WAS ASKED FOR, AND THAT IS THE SECOND REASON AND NOT
 * THE FIRST. On the runner, four vCPU `ubuntu-latest` under V8 coverage instrumentation, `should
 * hold the corpus out on its own` measured 93,869 to 243,730 ms across twenty two runs on
 * 2026-09-03 and 2026-09-04 and timed out at its declared 180,000 on the Node 22 verify job of
 * 2026-09-03. Roughly 84 to 85 percent of that was one repository wide `prettier .` scan whose
 * duration was set by how much build output the tree happened to be carrying. On an Apple M3 Ultra
 * workstation, 28 cores, on a built tree, recorded for contrast and never as a bound: that scan is
 * 15,936 ms and the reachability walk that replaces it is 192 ms, and the allowlist scan is 6,227
 * ms against 145 ms. Nothing was skipped to get there. The walk visits 1,423 files where the scan
 * read 386 differing ones out of everything on disk.
 *
 * WHAT LEFT THE SUBJECT, SAID PLAINLY. `prettier .` walks the filesystem; `git ls-files --cached
 * --others --exclude-standard` walks the repository. Build output is in the first and not in the
 * second, which is the whole reason the old reading moved with the state of `dist/`. The corpus,
 * `ai-docs/`, `CLAUDE.md` and `pnpm-lock.yaml`, which are what every case here asserts about, are
 * tracked files and are all still in the subject; `should find the vendored corpus in the
 * repository at all` below asserts that before anything is concluded from their presence or
 * absence.
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
    'should find the vendored corpus in the repository at all, before anything is concluded',
    () => {
      // Given, every case below concludes something from the corpus being reached or not reached,
      // and a subject that is not in the candidate set is absent from both answers. The change of
      // instrument narrowed the candidate set from the filesystem to the repository, so this is
      // the assertion that the narrowing did not take the subject with it.

      // When
      const documents = repositoryFiles().filter((file) => file.startsWith(`${CORPUS}/`));

      // Then, SPEC 21 puts the corpus floor at fifteen documents
      expect(documents.length).toBeGreaterThanOrEqual(15);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should reach no vendored corpus document, whatever the ignore file says',
    async () => {
      // Given, the ignore file the repository ships, named rather than left to a default
      const paths = pathsOf(scripts()['format:check'] ?? '');

      // When
      const reached = await prettierReach(patternFiles(paths), shippedIgnore());

      // Then
      expect(reached.some((file) => file.includes(CORPUS))).toBe(false);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  /**
   * THE CASE THAT WAS OVER ITS BOUND, AND WHAT THE MAINTAINER RULED ON 2026-09-04.
   *
   * WHAT IT COST, ON THE RUNNER, WHICH IS THE ONLY INSTRUMENT THAT COUNTS. Twenty two instrumented
   * coverage runs on 2026-09-03 and 2026-09-04, four vCPU `ubuntu-latest`, Node 22.22.2 and Node
   * 24: 93,869 ms at the low end and 243,730 ms at the high end, against the shared
   * {@link SPAWNED_PROCESS_TIMEOUT_MS} of 180,000 it declares. It was not near the bound, it was
   * past it: the 2026-09-03 Node 22 verify job failed on this case, timed out in 180000ms. An order
   * of magnitude over 243,730 ms is 2,437,300, which is 40.6 minutes, longer than the whole verify
   * job takes and far past what that job could absorb on top of its own work under any wall it has
   * had, so the margin this repository uses for the class could not be applied to it.
   *
   * THE RULING WAS THE REACHABILITY VARIANT, AND THE ARGUMENT FOR IT WAS THE THREE DOCUMENTS RATHER
   * THAN THE MILLISECONDS: more thorough rather than weaker. The file header names the three and
   * says what changed about the question. A cheaper instrument that answered a smaller question
   * would have been the wrong trade and was refused.
   *
   * NOTHING WAS SKIPPED, EXCLUDED OR MARKED SLOW TO GET HERE. The bound did not move, the global
   * vitest default did not move, and no case lost an assertion. The declared
   * {@link SPAWNED_PROCESS_TIMEOUT_MS} stays because the cost of this case is still a spawned
   * `git ls-files` over the whole repository, which is the class that constant names, and because
   * lowering a bound on the strength of one round of readings is how the last derivation came out
   * low. The new readings are recorded beside the old ones so the next person has both.
   */
  it(
    'should hold the corpus out on its own, with the ignore file taken away',
    async () => {
      // Given, an empty ignore file, so only the allowlist is doing any work. This is the
      // property under test: .prettierignore already excludes the corpus, and an ignore list
      // that happens to be right today is exactly what failed twice before.

      // When
      const everything = await prettierReach(repositoryFiles(), emptyIgnore());
      const allowed = await prettierReach(
        patternFiles(pathsOf(scripts()['format:check'] ?? '')),
        emptyIgnore(),
      );

      // Then, prettier reaches the corpus when nothing but the allowlist stands in its way,
      // and the allowlist is what keeps it out
      expect(everything.some((file) => file.includes(CORPUS))).toBe(true);
      expect(allowed.some((file) => file.includes(CORPUS))).toBe(false);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should reach the three corpus documents a difference scan cannot see',
    async () => {
      // Given, the reason the ruling chose this instrument. `--list-different` names a file only
      // when prettier would change its bytes, so a vendored document that is already formatted the
      // way prettier writes is invisible to it and indistinguishable from one the allowlist never
      // reached. Three of the seventeen are in that state. Naming them here is what makes the
      // difference between the two instruments a reading somebody can check rather than a claim.
      const alreadyFormatted = [
        `${CORPUS}/oai-callback-example.yaml`,
        `${CORPUS}/oai-non-oauth-scopes.yaml`,
        `${CORPUS}/oai-webhook-example.yaml`,
      ];

      // When
      const everything = await prettierReach(repositoryFiles(), emptyIgnore());
      const corpus = everything.filter((file) => file.includes(CORPUS));

      // Then, every corpus document the repository holds is reached, the three among them, and
      // prettier really would leave each of those three byte identical, which is what made them
      // invisible to the old instrument. The count is asserted against the corpus rather than
      // against the literal seventeen, so a document added tomorrow is covered with nothing to
      // edit here, and the SPEC 21 floor keeps an empty corpus from passing.
      const held = repositoryFiles().filter((file) => file.startsWith(`${CORPUS}/`));
      expect(held.length).toBeGreaterThanOrEqual(15);
      expect(corpus.length).toBe(held.length);
      for (const file of alreadyFormatted) {
        expect(corpus).toContain(file);
      }
      expect(differing(alreadyFormatted)).toEqual([]);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should leave the specification and the instructions alone without the ignore file',
    async () => {
      // Given

      // When, the identical question the case above asked, answered from the cache rather than by
      // walking the whole allowlist a second time
      const allowed = await prettierReach(
        patternFiles(pathsOf(scripts()['format:check'] ?? '')),
        emptyIgnore(),
      );

      // Then, and the first two assertions are what keep the three absences below from being the
      // absence of an empty answer: the allowlist expanded to files, and it reached them.
      expect(patternFiles(pathsOf(scripts()['format:check'] ?? '')).length).toBeGreaterThan(100);
      expect(allowed.length).toBeGreaterThan(100);

      // `pnpm-lock.yaml` is tracked, so it is in every checkout and its absence here is a reading.
      expect(repositoryFiles()).toContain('pnpm-lock.yaml');
      expect(allowed.some((file) => file.endsWith('pnpm-lock.yaml'))).toBe(false);

      // `ai-docs/` and `CLAUDE.md` ARE NOT IN THE REPOSITORY AT ALL, by the same deliberate
      // exclusion the coverage gate reports on a clone, so on a runner there is nothing on disk for
      // the allowlist to reach and this assertion cannot fail there however wrong the list gets.
      // That is a class of defect this check is silent about, and a check that cannot establish a
      // fact says so instead of reporting the answer that means success.
      for (const document of ['ai-docs', 'CLAUDE.md']) {
        if (!existsSync(join(repoRoot, document))) {
          console.log(
            `format-allowlist: ${document} is not in this checkout, so this run did not check ` +
              'that the allowlist leaves it alone. It is excluded from git by design and no ' +
              'clone restores it; the reading is the one taken where the document is present.',
          );
        }
      }
      expect(allowed.some((file) => file.includes('ai-docs/'))).toBe(false);
      expect(allowed.some((file) => file.endsWith('CLAUDE.md'))).toBe(false);
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
      // found it already formatted is indistinguishable from a list that never reached it. This
      // case was the only one asking the question this way; since 2026-09-04 it is how the whole
      // file asks it, through the one {@link patternFiles} expansion.
      const listed = new Set(patternFiles(pathsOf(scripts()['format:check'] ?? '')));

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

/** The ignore file the repository actually ships, named rather than defaulted to. */
function shippedIgnore(): string {
  return join(repoRoot, '.prettierignore');
}

/** The vendored documents every case in this file is ultimately about. */
const CORPUS = 'packages/core/test/corpus/documents';

/**
 * Every file the repository holds, tracked or newly written, never one git ignores.
 *
 * This is the candidate set the whole-repository question is asked over, and it is the half of the
 * instrument change that a reader has to see: `prettier .` walks a directory tree, this walks a
 * repository. The difference is build output and nothing the allowlist protects.
 *
 * @returns Repository relative paths, in git's order
 */
function repositoryFiles(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * The files a set of the format script's own patterns expands to.
 *
 * The partition case at the bottom of this file already expanded the script's patterns this way
 * and for this reason. There is one expansion now instead of two spellings of one question.
 *
 * @param patterns - Path patterns, as the format script writes them
 * @returns Repository relative paths, deduplicated
 */
function patternFiles(patterns: readonly string[]): string[] {
  return [
    ...new Set(
      patterns.flatMap((pattern) =>
        globSync(pattern, { cwd: repoRoot }).map((file) => file.split(sep).join('/')),
      ),
    ),
  ];
}

/** Every reach already computed, keyed by the ignore file and the candidates it was asked over. */
const reaches = new Map<string, string[]>();

/**
 * The files prettier would ACT ON, out of a candidate set, under one ignore file.
 *
 * WHAT "ACT ON" MEANS HERE, EXACTLY, because the whole point of the change is that it is not what
 * the old instrument meant. `getFileInfo` answers two things about a path: whether the ignore file
 * excludes it, and which parser prettier infers for it. A file that is not ignored and has an
 * inferred parser is a file `prettier --write` would open and rewrite the contents of. Whether the
 * bytes would come out different is a separate question and is the one that was being asked by
 * mistake.
 *
 * ANSWERED ONCE PER QUESTION. Two cases below ask the identical question, the allowlist against an
 * empty ignore file, and the second answer was never going to differ from the first: same
 * candidates, same ignore file, same tree, no case here writes to any of them.
 *
 * @param candidates - Repository relative paths to ask about
 * @param ignorePath - The ignore file to resolve against
 * @returns The candidates prettier would act on, in the order given
 */
async function prettierReach(candidates: readonly string[], ignorePath: string): Promise<string[]> {
  const key = JSON.stringify([ignorePath, ...candidates]);
  const cached = reaches.get(key);
  if (cached !== undefined) return cached;

  const reached: string[] = [];
  for (const file of candidates) {
    const info = await getFileInfo(join(repoRoot, file), { ignorePath, resolveConfig: false });
    if (!info.ignored && info.inferredParser !== null) reached.push(file);
  }

  reaches.set(key, reached);

  return reached;
}

/**
 * The old instrument, kept for the one thing only it can say, over a named handful of files.
 *
 * `--list-different` is what this file used to ask everywhere and it is not deleted, because the
 * claim that three corpus documents are invisible to it is a claim about it and has to be checked
 * with it. Over three named paths that is one spawn of a few tens of milliseconds, and an empty
 * answer here is the evidence that those three really are already prettier formatted.
 *
 * @param files - Repository relative paths to ask about
 * @returns Those of them prettier would rewrite, which for an already formatted file is none
 */
function differing(files: readonly string[]): string[] {
  let output: string;
  try {
    output = execFileSync(
      'pnpm',
      ['exec', 'prettier', '--list-different', '--ignore-path', emptyIgnore(), ...files],
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
