import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The published surface of `@openref/vue`, asserted against the artefact rather than the source.
 *
 * WHY THE BUILT TYPES AND NOT `src/index.ts`. A package that exports more than it documents is
 * the same family of defect as a slot nobody could supply: the declaration and the artefact
 * disagree, and only the artefact ships. Reading the source would check that this repository's
 * intent matches its own document; reading `dist/*.d.ts` checks what a theme author's editor
 * actually offers them, which is the claim `PUBLIC-API.md` makes.
 *
 * IT RUNS IN BOTH DIRECTIONS. An undocumented export is a surface that grew without anyone
 * deciding to freeze it. A documented name the package does not export is a document promising
 * something an author cannot import, which is worse, because they find out by trying.
 *
 * A MISSING BUILD IS A FAILURE AND NEVER A SKIP, per the same rule `module-formats.spec.ts`
 * states: an unreadable artefact and a clean one produce the same empty list.
 */

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** One entry point, and the file that documents it. */
const ENTRY_POINTS = [
  { specifier: '@openref/vue', declarations: 'dist/index.d.ts' },
  { specifier: '@openref/vue/runner', declarations: 'dist/runner.d.ts' },
] as const;

/**
 * Reads a built file, refusing to pass when there is nothing to read.
 *
 * @param relative - Path inside the package
 * @returns The absolute path
 * @throws Error when the artefact is not built
 */
function built(relative: string): string {
  const path = join(packageRoot, relative);

  if (!existsSync(path)) {
    throw new Error(`${relative} is not built. Run pnpm build; a missing artifact is not a pass`);
  }

  return path;
}

/** A compiled declaration file: the checker that read it, and the module symbol it produced. */
interface Compiled {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly moduleSymbol: ts.Symbol;
}

/** One program per declaration file, keyed by absolute path. */
const compiled = new Map<string, Compiled>();

/**
 * The compiler's reading of one declaration file, built once and reused.
 *
 * ONE PROGRAM PER FILE AND NOT ONE PER QUESTION, because the program is the whole cost. The five
 * cases below ask six questions about two `.d.ts` files, and each question used to build its own
 * `ts.createProgram` over the same declaration and the same transitive lib and package types. Six
 * programs over two files is five sixths of the work thrown away, and it is the work that set every
 * duration in this file: on the runner the four compiling cases measured 8,766 to 9,875 ms at their
 * maxima while the assertions they make are set comparisons over a few hundred strings.
 *
 * THE CACHE IS THE FIX AND NOT A LARGER BOUND. A bound is a hang catcher; it does not make a case
 * cheaper, and raising one to cover duplicated work is how a suite stops being able to tell a hang
 * from its own habits. The answers are identical either way: the program is built from the same
 * file with the same options, and nothing here mutates it.
 *
 * @param declarations - Absolute path to a `.d.ts`
 * @returns The checker and module symbol for that file
 * @throws {Error} When the file does not parse or is not a module
 */
function compile(declarations: string): Compiled {
  const cached = compiled.get(declarations);
  if (cached !== undefined) return cached;

  const program = ts.createProgram([declarations], { target: ts.ScriptTarget.ES2022 });
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(declarations);

  if (file === undefined) throw new Error(`${declarations} did not parse`);

  const moduleSymbol = checker.getSymbolAtLocation(file);
  if (moduleSymbol === undefined) throw new Error(`${declarations} is not a module`);

  const entry: Compiled = { program, checker, moduleSymbol };
  compiled.set(declarations, entry);

  return entry;
}

/**
 * Every name a declaration file exports, read through the compiler rather than by pattern.
 *
 * A REGULAR EXPRESSION WOULD BE A SECOND IMPLEMENTATION OF THE MODULE SYSTEM. `export *`,
 * `export { x as y }` and a re-export through a chunk are all the same question to the checker
 * and three different patterns to a scanner, and the one it missed would read as a clean surface.
 *
 * @param declarations - Absolute path to a `.d.ts`
 * @returns The exported names, sorted
 */
function exportedNames(declarations: string): string[] {
  const { checker, moduleSymbol } = compile(declarations);

  return checker
    .getExportsOfModule(moduleSymbol)
    .map((exported) => exported.getName())
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Every name `PUBLIC-API.md` lists in a surface table, which is its first column in backticks.
 *
 * The document has tables that are not surface tables, the entry point table and the contract
 * table among them, so a row counts only when its second column says `value` or `type`.
 *
 * @param markdown - The document
 * @returns The documented names, sorted
 */
function documentedNames(markdown: string): string[] {
  const rows = [...markdown.matchAll(/^\|\s*`([^`]+)`\s*\|\s*(value|type)\s*\|/gm)];

  return [...new Set(rows.map((row) => row[1] ?? ''))].sort((left, right) =>
    left.localeCompare(right),
  );
}

/**
 * The full text of one exported declaration, leading JSDoc included.
 *
 * What an editor shows an author beside a name is the declaration and its comment, so a claim
 * about what the surface tells an author is checked against that text and not against `src/`.
 *
 * @param declarations - Absolute path to a `.d.ts`
 * @param name - The exported name
 * @returns The declaration text as the artefact carries it
 */
function declarationText(declarations: string, name: string): string {
  const { checker, moduleSymbol } = compile(declarations);

  const exported = checker
    .getExportsOfModule(moduleSymbol)
    .find((entry) => entry.getName() === name);
  if (exported === undefined) throw new Error(`${name} is not exported by ${declarations}`);

  // The export statement aliases the declaration, and the alias's own text is the specifier,
  // not the interface, so the claim has to be read off the declaration the alias points at.
  const resolved =
    (exported.flags & ts.SymbolFlags.Alias) === 0 ? exported : checker.getAliasedSymbol(exported);
  const declaration = resolved.getDeclarations()?.[0];
  if (declaration === undefined) throw new Error(`${name} has no declaration in ${declarations}`);

  return declaration.getFullText();
}

/**
 * The margin the bound below clears over what was measured, and the checked one.
 *
 * AN ORDER OF MAGNITUDE, WHICH IS THE MARGIN THIS REPOSITORY ALREADY USES FOR THIS CLASS, and it is
 * a constant here rather than a sentence because a sentence cannot go red. The first draft stated
 * the margin in prose over maxima taken from nine of the ten samples that existed, and the sample
 * it dropped was the one carrying every maximum. A margin the file asserts about itself moves the
 * bound or changes the claim; a margin in a comment does neither.
 */
const MARGIN = 10;

/**
 * The heaviest reading any compiling case in this file produced on the runner.
 *
 * MEASURED ON THE RUNNER, WHICH IS THE ONLY INSTRUMENT THAT COUNTS HERE. Six coverage runs on
 * 2026-09-04, on the four vCPU `ubuntu-latest` runner under V8 instrumentation, over Node 22.22.2
 * and Node 24, spread across the AMD EPYC models the pool handed out.
 *
 * IT IS ONE FIGURE BECAUSE THE PROGRAMS ARE PAID ONCE, by whichever compiling case runs first.
 * That case measured 3,483 to 8,802 ms; the other three measured 1 to 2 ms behind it, and they
 * declare the bound anyway, because which of the four pays is an ordering accident and not a
 * property of any of them.
 *
 * WHAT IT WAS BEFORE THE CACHE, over ten samples on 2026-09-03: 9,875, 9,086, 8,766 and 4,309 ms,
 * four cases each building its own programs. The file total went from 31,655 ms to 8,810 ms at
 * their maxima. Ten samples and not nine, which is what the first derivation counted: it read six
 * artifacts from one study run and four from a second, and dropped `durations-node22-sample3`,
 * which carried every maximum in this file.
 *
 * THE WORKSTATION IS NOT THE INSTRUMENT. The same cases ran at roughly a third of the runner's
 * figures on an Apple M3 Ultra, which is the whole reason this file was green for a run of commits
 * that never reached CI and red the first time one did.
 */
const MEASURED_MAXIMUM_MS = 8_802;

/**
 * The hang catcher the compiling cases declare, because their cost is the compiler.
 *
 * F25, AND THE CLASS IS THE ONE `vitest.spawn-timeout.ts` NAMES rather than the class vitest's
 * five second default was chosen for. Every case below that reads a name off an artefact reaches a
 * TypeScript program over a declaration file and its transitive lib and package types, for the
 * reason `exportedNames` gives: a scanner would be a second implementation of the module system.
 * What that costs is set by the compiler, by the size of the declaration graph and by the disk, and
 * none of it is a property of the surface under test. The assertions themselves are set comparisons
 * over a few hundred strings.
 *
 * THE FOURTH CASE DECLARES IT TOO, THOUGH IT HAS NOT GONE RED. It is the same class inside the same
 * file, and leaving it out would be leaving the next red run in place rather than fixing the one
 * that happened.
 *
 * THE MARGIN IS CHECKED AND NOT ASSERTED IN PROSE. The last case in this file holds this number to
 * {@link MARGIN} over {@link MEASURED_MAXIMUM_MS}, and the value is the one
 * `tools/docs-site/test/integration/documentation-examples.spec.ts` already carries on both of its
 * `ts.createProgram` cases. That file is where the number is borrowed from and not evidence for the
 * doctrine: it carries 120,000 as two bare literals with no comment, no recorded maximum and no
 * margin claimed. `packages/render/test/integration/corpus-navigation.spec.ts` is the one file that
 * genuinely states the doctrine, and what it states is the rule rather than a measurement.
 *
 * NOTHING HERE IS TUNED AGAINST THIS NUMBER AND NOTHING SHOULD BE. It is a hang catcher, not a
 * budget. The three cases in this file that touch no program declare nothing and keep vitest's
 * default, because they are the class the default was chosen for, and the global default does not
 * move.
 */
const COMPILER_HANG_CATCHER_MS = 120_000;

describe('the published surface of @openref/vue', () => {
  const document = readFileSync(join(packageRoot, 'PUBLIC-API.md'), 'utf8');

  it(
    'should export nothing beyond what PUBLIC-API.md documents',
    () => {
      // Given
      const documented = new Set(documentedNames(document));

      // When
      const undocumented = ENTRY_POINTS.flatMap(({ specifier, declarations }) =>
        exportedNames(built(declarations))
          .filter((name) => !documented.has(name))
          .map((name) => `${specifier}: ${name}`),
      );

      // Then
      expect(undocumented).toEqual([]);
    },
    COMPILER_HANG_CATCHER_MS,
  );

  it(
    'should export everything PUBLIC-API.md documents',
    () => {
      // Given
      const exported = new Set(
        ENTRY_POINTS.flatMap(({ declarations }) => exportedNames(built(declarations))),
      );

      // When
      const promised = documentedNames(document).filter((name) => !exported.has(name));

      // Then
      expect(promised).toEqual([]);
    },
    COMPILER_HANG_CATCHER_MS,
  );

  it('should document a surface, so an empty document cannot pass either assertion', () => {
    // Given, the two assertions above are both green over an empty document and an empty
    // package, which is the shape a proof of absence takes when the subject is absent.

    // When
    const documented = documentedNames(document);

    // Then
    expect(documented.length).toBeGreaterThan(100);
    expect(documented).toContain('useSlot');
    expect(documented).toContain('defineTheme');
  });

  it('should name a milestone on every stubbed or unsupplied row, because a dead name in a frozen surface needs a date', () => {
    // Given, the table that says which composables a page cannot use yet. useSocket is a stub,
    // useChannel finds nothing until a document carries channels, and useSearch works the moment
    // a host supplies the port while the shipped page never does. Each of those states is only
    // honest while it says when it ends, which is the same rule the useSocket refusal is held to.
    const heading = document.indexOf('## What is stubbed, and until when');
    expect(heading).toBeGreaterThan(-1);
    const table = document.slice(heading);

    // When
    const rows = [...table.matchAll(/^\|\s*`([^`]+)`\s*\|[^|]*\|([^|]*)\|/gm)];

    // Then
    expect(rows.map((row) => row[1])).toContain('useSearch');
    expect(rows.map((row) => row[1])).toContain('useSocket');
    for (const row of rows) {
      expect(row[2], `${row[1] ?? ''} names no milestone`).toMatch(/\bM[1-7]\b/);
    }
  });

  it(
    'should carry the milestone on the unavailable search in the artefact an editor reads',
    () => {
      // Given, the audit of session 49 counted useSearch implemented, which is true of the
      // function and false of the page. The sentence that keeps the difference visible lives on
      // `available`, and it ships in the declaration file, so it is asserted there: a later build
      // dropping the comment, or a reword losing the milestone, goes red rather than shipping.

      // When
      const text = declarationText(built('dist/index.d.ts'), 'UseSearch');

      // Then
      expect(text).toMatch(/\bM[1-7]\b/);
    },
    COMPILER_HANG_CATCHER_MS,
  );

  it(
    'should keep the try-it surface off the entry point a first paint imports',
    () => {
      // Given, the split is a byte measurement and not a taxonomy: with `useRunner` on the main
      // barrel it sat in the first paint chunk of every page at 962 bytes, for a console most
      // readers never open. A re-export added back here would undo that in silence.

      // When
      const main = exportedNames(built('dist/index.d.ts'));

      // Then
      expect(main).not.toContain('useRunner');
      expect(main).not.toContain('useRunnerFor');
      expect(exportedNames(built('dist/runner.d.ts'))).toContain('useRunnerFor');
    },
    COMPILER_HANG_CATCHER_MS,
  );

  it('should hold the bound over the reading that was taken, by the margin it claims', () => {
    // Given, the margin used to be a sentence, and a sentence cannot go red. It was written over
    // nine of the ten samples that existed, and the tenth carried every maximum in this file, so
    // the arithmetic the prose claimed was not the arithmetic the readings supported. Both the
    // bound and the reading live here now: a case that grows past a tenth of the bound reddens
    // this, and whoever finds it moves the number or changes the claim.

    // When, Then
    expect(COMPILER_HANG_CATCHER_MS / MEASURED_MAXIMUM_MS).toBeGreaterThanOrEqual(MARGIN);

    // And the cache is what keeps the reading where it is, asserted as the property rather than as
    // a count so it does not depend on which cases ran first: asking twice reaches one program,
    // and no more programs exist than there are entry points to build them over.
    expect(compile(built('dist/index.d.ts'))).toBe(compile(built('dist/index.d.ts')));
    expect(compiled.size).toBeLessThanOrEqual(ENTRY_POINTS.length);
  });
});
