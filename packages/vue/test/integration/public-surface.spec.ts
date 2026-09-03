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
  const program = ts.createProgram([declarations], { target: ts.ScriptTarget.ES2022 });
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(declarations);

  if (file === undefined) throw new Error(`${declarations} did not parse`);

  const symbol = checker.getSymbolAtLocation(file);
  if (symbol === undefined) throw new Error(`${declarations} is not a module`);

  return checker
    .getExportsOfModule(symbol)
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
  const program = ts.createProgram([declarations], { target: ts.ScriptTarget.ES2022 });
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(declarations);

  if (file === undefined) throw new Error(`${declarations} did not parse`);

  const symbol = checker.getSymbolAtLocation(file);
  if (symbol === undefined) throw new Error(`${declarations} is not a module`);

  const exported = checker.getExportsOfModule(symbol).find((entry) => entry.getName() === name);
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
 * The hang catcher the compiling cases declare, because their cost is the compiler.
 *
 * F25, AND THE CLASS IS THE ONE `vitest.spawn-timeout.ts` NAMES rather than the class vitest's
 * five second default was chosen for. Every case below that reads a name off an artefact builds a
 * whole TypeScript program over a declaration file and its transitive lib and package types, for
 * the reason `exportedNames` gives: a scanner would be a second implementation of the module
 * system. What that costs is set by the compiler, by the size of the declaration graph and by the
 * disk, and none of it is a property of the surface under test. The assertions themselves are set
 * comparisons over a few hundred strings.
 *
 * MEASURED ON THE RUNNER, WHICH IS THE ONLY INSTRUMENT THAT COUNTS HERE. Nine coverage runs on
 * 2026-09-03, on the four vCPU `ubuntu-latest` runner under V8 instrumentation, over Node 22.22.2
 * and Node 24, spread across an AMD EPYC 7763, an EPYC 9V45 and an EPYC 9V74 as the pool handed
 * them out. The four compiling cases measured, at their maxima, 8,970, 8,040, 7,590 and 4,309 ms,
 * against 2,740, 2,141, 2,262 and 1,094 ms for the same four on an Apple M3 Ultra workstation.
 * That gap is the whole reason this file was green for a run of commits that never reached CI and
 * red the first time one did, so the workstation figures are recorded for contrast and are not
 * what this number is derived from.
 *
 * THE FOURTH CASE DECLARES IT TOO, THOUGH IT HAS NOT GONE RED YET. 4,309 of 5,000 is the same
 * class inside the same file at 86 percent of the bound, and leaving it out would be leaving the
 * next red run in place rather than fixing the one that happened.
 *
 * THE MARGIN IS THE ONE THE PROJECT ALREADY USES, an order of magnitude over the measured maximum,
 * rounded to the value this repository already carries for this class. 8,970 ms times ten is
 * 89,700, and `tools/docs-site/test/integration/documentation-examples.spec.ts` carries 120,000 on
 * both of its `ts.createProgram` cases. Adopting it lowers no bound anybody had already found they
 * needed, which is the property `vitest.spawn-timeout.ts` asks of one number for a whole class.
 *
 * NOTHING HERE IS TUNED AGAINST THIS NUMBER AND NOTHING SHOULD BE. It is a hang catcher, not a
 * budget. The two cases in this file that read only the markdown declare nothing and keep vitest's
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
});
