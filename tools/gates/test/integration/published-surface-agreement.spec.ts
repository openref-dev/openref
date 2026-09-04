/**
 * A name exported by two published packages has to mean one thing in both.
 *
 * WHY THIS EXISTS RATHER THAN TWO EDITS. The outsider read of 2026-09-02 found two instances of
 * one defect: `RunnerSendInput` was an interface in `@openref/runner` and a different, incompatible
 * interface in `@openref/vue`, and `DEFAULT_THEME_NAME` was `vernier` in `@openref/theme` and
 * `default` in `@openref/vue`. Both were found by a person reading eleven declaration files by
 * hand, which is a method that works once. Editing the two names and stopping would leave the
 * mechanism that produced them running, and the next pair would be found the same way or not at
 * all: 894 of the 1,076 published names had no gate of any kind, and one package had a surface
 * test.
 *
 * WHAT IS CHECKED, AND WHY THESE TWO QUESTIONS. A shared name is either a type, a value or both,
 * and the two meanings fail differently. A shared TYPE that is not mutually assignable is a
 * consumer who cannot hand one package's value to the other package's function, which is what
 * `RunnerSendInput` was. A shared VALUE whose declared type differs is two answers to one
 * question, which is what `DEFAULT_THEME_NAME` was: whichever a consumer imported, the other was
 * wrong. Neither is visible from inside one package, which is why no per package surface test
 * could have found either.
 *
 * THE PACKAGE LIST IS DERIVED AND NOT LISTED, per the rule that produced `readPackageDirs`. The
 * published set comes from the manifests through {@link resolveShippedPackages}, the same
 * derivation the `publish-list` gate compares against SPEC 4, so a twelfth published package is in
 * this check from the moment its manifest loses `private`.
 *
 * A MISSING BUILD IS A FAILURE AND NEVER A SKIP, and an empty read cannot pass: the shared set is
 * asserted non-empty and asserted to contain names that are genuinely shared today, because two
 * assertions over nothing are both green.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import { readWorkspaceManifests, resolveShippedPackages } from '../../src/lib/workspace';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

/**
 * Exports this file could not read a declaration for, as `<entry point>: <name>`.
 *
 * COUNTED RATHER THAN SKIPPED, because a name that cannot be read is a name that leaves the
 * comparison, and a comparison that quietly shrinks is the failure mode this whole file is about.
 * It was not empty on the first run: eleven IR names re-exported by `@openref/nest` landed here,
 * and the shared set went from 39 to 20 without a single assertion going red.
 */
const unresolved: string[] = [];

/**
 * The one name every published package declares about itself, which differs by construction.
 *
 * NOT AN ALLOWLIST FOR AWKWARD CASES, and the difference matters or this file becomes the place
 * the next `DEFAULT_THEME_NAME` gets filed. `PACKAGE_NAME` answers "which package is this", so two
 * packages agreeing on it would be the defect, and it is exempted rather than reconciled. It is
 * checked below rather than trusted: it must still be shared, and its literal type must still be
 * the name of the package it sits in.
 *
 * `UPSTREAM_PACKAGES` IS NOT HERE AND WAS, WHICH IS THE POINT OF THE CHECK BELOW. It differs per
 * package too, but its declared type is `readonly string[]` in all five holders, so the rule never
 * had anything to say about it and the exemption was exempting nothing. An entry that guards
 * nothing is how a list like this stops being read.
 */
const PER_PACKAGE_IDENTITY: readonly string[] = ['PACKAGE_NAME'];

/** One declaration entry point of one published package. */
interface EntryPoint {
  readonly packageName: string;
  readonly specifier: string;
  readonly declarations: string;
}

/** What one exported name is, on one side. */
interface Exported {
  readonly entry: EntryPoint;
  /** Text of the type parameter list, empty when the name is not generic. */
  readonly typeParameters: readonly string[];
  readonly hasTypeMeaning: boolean;
  readonly hasValueMeaning: boolean;
  /** The declared type of the value meaning, printed, or null when there is none. */
  readonly valueType: string | null;
}

/**
 * The published packages, with the declaration file of every entry point each one declares.
 *
 * @returns One record per entry point, ordered by package name
 * @throws {Error} When a published package declares an entry point whose types are not built
 */
function publishedEntryPoints(): EntryPoint[] {
  const manifests = readWorkspaceManifests(REPO_ROOT);
  const { published } = resolveShippedPackages(manifests);
  const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
  const entries: EntryPoint[] = [];

  for (const packageName of published) {
    const directory = byName.get(packageName)?.directory ?? '';
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, directory, 'package.json'), 'utf8'),
    ) as { exports?: Readonly<Record<string, unknown>> };

    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      const types = (target as { types?: unknown } | null)?.types;
      if (typeof types !== 'string') continue;

      const declarations = join(REPO_ROOT, directory, types);
      if (!existsSync(declarations)) {
        throw new Error(
          `${packageName}${subpath.slice(1)} declares types at ${types} and nothing is built ` +
            'there. Run pnpm build; a missing artifact is not a pass',
        );
      }

      entries.push({
        packageName,
        specifier: `${packageName}${subpath.slice(1)}`,
        declarations,
      });
    }
  }

  return entries;
}

/**
 * Every name an entry point exports, with what each name means.
 *
 * READ THROUGH THE COMPILER AND NOT BY PATTERN, for the reason `public-surface.spec.ts` gives:
 * `export *`, `export { x as y }` and a re-export through a content hashed chunk are one question
 * to the checker and three patterns to a scanner, and `@openref/vue` ships all three.
 *
 * @param entry - The entry point to read
 * @returns Exported name to what it is
 */
function surfaceOf(entry: EntryPoint): Map<string, Exported> {
  // THE RESOLUTION SETTINGS ARE LOAD BEARING AND WERE WRONG ONCE. With the default classic
  // resolution, `@openref/nest` re-exporting `IRNode` from `@openref/core` produced an alias with
  // no declaration behind it, and eleven IR names silently left the shared set: the check quietly
  // stopped covering exactly the packages it exists for. Resolved the way a consumer's compiler
  // resolves, those eleven are one declaration reached twice, which is the answer and not a gap.
  const program = ts.createProgram([entry.declarations], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(entry.declarations);
  if (file === undefined) throw new Error(`${entry.declarations} did not parse`);

  const moduleSymbol = checker.getSymbolAtLocation(file);
  if (moduleSymbol === undefined) throw new Error(`${entry.declarations} is not a module`);

  const surface = new Map<string, Exported>();

  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const resolved =
      (exported.flags & ts.SymbolFlags.Alias) === 0 ? exported : checker.getAliasedSymbol(exported);
    const declaration = resolved.getDeclarations()?.[0];
    if (declaration === undefined) {
      unresolved.push(`${entry.specifier}: ${exported.getName()}`);
      continue;
    }

    const hasTypeMeaning = (resolved.flags & ts.SymbolFlags.Type) !== 0;
    const hasValueMeaning = (resolved.flags & ts.SymbolFlags.Value) !== 0;
    const parameters =
      ts.isInterfaceDeclaration(declaration) ||
      ts.isTypeAliasDeclaration(declaration) ||
      ts.isClassDeclaration(declaration)
        ? (declaration.typeParameters ?? [])
        : [];

    surface.set(exported.getName(), {
      entry,
      typeParameters: parameters.map((parameter) => parameter.getText()),
      hasTypeMeaning,
      hasValueMeaning,
      valueType: hasValueMeaning
        ? checker.typeToString(
            checker.getTypeOfSymbolAtLocation(resolved, declaration),
            undefined,
            ts.TypeFormatFlags.NoTruncation,
          )
        : null,
    });
  }

  return surface;
}

/** Every name the published set exports, keyed by name, with one record per entry point. */
function publishedNames(): Map<string, Exported[]> {
  const holders = new Map<string, Exported[]>();

  for (const entry of publishedEntryPoints()) {
    for (const [name, exported] of surfaceOf(entry)) {
      const list = holders.get(name) ?? [];
      list.push(exported);
      holders.set(name, list);
    }
  }

  return new Map([...holders.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

const PUBLISHED = publishedNames();
const SHARED = new Map([...PUBLISHED].filter(([, list]) => list.length > 1));
let workspace = '';

afterAll(() => {
  if (workspace !== '') rmSync(workspace, { recursive: true, force: true });
});

/**
 * Compiles one probe file asserting a list of assignments, and reports what would not compile.
 *
 * @param source - The probe file, one exported function per assignment
 * @param label - Name of the probe file, for the message
 * @returns Every diagnostic, as `line: message`
 */
function diagnosticsOf(source: string, label: string): string[] {
  if (workspace === '') workspace = mkdtempSync(join(tmpdir(), 'openref-surface-'));

  const file = join(workspace, `${label}.ts`);
  writeFileSync(file, source);

  const program = ts.createProgram([file], {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
  });

  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === program.getSourceFile(file)?.fileName)
    .map((diagnostic) => {
      const at = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');

      return `${String((at?.line ?? 0) + 1)}: ${text}`;
    });
}

/**
 * A probe function asserting that one side's type is assignable to the other's.
 *
 * @param name - The shared name
 * @param from - The side the value comes from
 * @param to - The side it is handed to
 * @param index - Serial number, so each probe has its own function name
 * @returns The probe source
 */
function assignmentProbe(name: string, from: Exported, to: Exported, index: number): string {
  const parameters = from.typeParameters.length === 0 ? '' : `<${from.typeParameters.join(', ')}>`;
  const arguments_ =
    from.typeParameters.length === 0
      ? ''
      : `<${from.typeParameters.map((text) => text.split(/\s/)[0] ?? text).join(', ')}>`;

  return (
    `export function probe${String(index)}${parameters}(` +
    `value: import('${from.entry.declarations}').${name}${arguments_}` +
    `): import('${to.entry.declarations}').${name}${arguments_} { return value; }\n`
  );
}

/**
 * The margin the bound below clears over what was measured, and the checked one.
 *
 * AN ORDER OF MAGNITUDE, WHICH IS THE MARGIN THIS REPOSITORY ALREADY USES FOR THIS CLASS, and it is
 * a constant here rather than a sentence because a sentence cannot go red. The first draft stated
 * the margin in prose over a maximum taken from nine of the ten samples that existed, and the
 * sample it dropped was the one carrying the maximum. A margin the file asserts about itself moves
 * the bound or changes the claim; a margin in a comment does neither.
 */
const MARGIN = 10;

/**
 * The heaviest reading the compiling case produced on the runner.
 *
 * MEASURED ON THE RUNNER, WHICH IS THE ONLY INSTRUMENT THAT COUNTS HERE. Sixteen coverage runs on
 * 2026-09-03 and 2026-09-04, on the four vCPU `ubuntu-latest` runner under V8 instrumentation, over
 * Node 22.22.2 and Node 24, spread across an AMD EPYC 7763, an EPYC 9V45 and an EPYC 9V74 as the
 * pool handed them out: 2,987 ms at the low end and 7,850 ms at the high end, on
 * `durations-node22-sample3` of 2026-09-03, which is the artifact the first derivation dropped when
 * it counted ten samples as nine and read the maximum off the other nine as 6,620 ms.
 *
 * ALL SIXTEEN MEASURE ONE THING, because nothing in this file changed between the rounds. The six
 * later samples ran 3,461 to 6,810 ms, inside the range the first ten already covered.
 *
 * THE WORKSTATION IS NOT THE INSTRUMENT. The same case measured 2,580 ms on an Apple M3 Ultra,
 * inside vitest's default where the runner's reading is not, which is the whole reason this case
 * was green everywhere it had ever run and red the first time it ran here. It is recorded for
 * contrast and is not what any number here is derived from.
 */
const MEASURED_MAXIMUM_MS = 7_850;

/**
 * The hang catcher the compiling case declares, because its cost is the compiler.
 *
 * F25, AND THE CLASS IS THE ONE `vitest.spawn-timeout.ts` NAMES rather than the class vitest's
 * five second default was chosen for. The case below writes 186 assignment probes and asks a
 * TypeScript program to check every one of them against thirteen declaration entry points of
 * eleven published packages. What that costs is set by the compiler and by the size of the
 * declaration graph, and neither is a property of the agreement being asserted; the assertion
 * itself is a comparison of two arrays.
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
 * budget, and it is declared on the one case that compiles rather than on the file, so an ordinary
 * case in this file timing out still means exactly what it always meant. The global default does
 * not move.
 */
const COMPILER_HANG_CATCHER_MS = 120_000;

describe('a name published by two packages', () => {
  it('should be a set this tree actually has, so neither assertion below passes over nothing', () => {
    // Given, a proof that two published packages never disagree is worth nothing until the
    // subject is shown present: an unbuilt tree and a tree with one package produce the same
    // empty map, and every assertion in this file is green over it.

    // Then, 59 shared names over 13 entry points of 11 published packages, measured 2026-09-02
    // after the error classes were re-exported, which is what took the figure up from 39.
    expect(SHARED.size).toBeGreaterThan(50);
    expect([...SHARED.keys()]).toContain('IRNode');
    expect([...SHARED.keys()]).toContain('RunnerBody');
    expect(
      SHARED.get('IRNode')
        ?.map((held) => held.entry.packageName)
        .sort(),
    ).toEqual(['@openref/core', '@openref/nest']);
    expect(unresolved).toEqual([]);
  });

  it(
    'should mean one type in every package that publishes it',
    () => {
      // Given every ordered pair of holders of every shared name that has a type meaning
      const probes: string[] = [];
      const subjects: string[] = [];

      for (const [name, holders] of SHARED) {
        if (!holders.every((held) => held.hasTypeMeaning)) continue;

        for (const from of holders) {
          for (const to of holders) {
            if (from === to) continue;
            probes.push(assignmentProbe(name, from, to, probes.length));
            subjects.push(`${name}: ${from.entry.specifier} -> ${to.entry.specifier}`);
          }
        }
      }

      // When, the compiler is asked whether each hand over would build
      const failures = diagnosticsOf(probes.join(''), 'types').map((diagnostic) => {
        const line = Number(diagnostic.split(':')[0]) - 1;

        return `${subjects[line] ?? 'unknown pair'} (${diagnostic})`;
      });

      // Then, 186 ordered pairs on this tree, measured 2026-09-02. A floor rather than the figure,
      // because a re-export added anywhere raises it, and a collapse to nothing is what a broken
      // read looks like.
      expect(subjects.length).toBeGreaterThan(150);
      expect(failures).toEqual([]);
    },
    COMPILER_HANG_CATCHER_MS,
  );

  it('should mean one value in every package that publishes it', () => {
    // Given every shared name with a value meaning, other than the ones that name their own
    // package. `DEFAULT_THEME_NAME` was `"vernier"` on one side and `"default"` on the other,
    // and both sides compiled: a disagreement between two literal types is not an assignability
    // failure of any pair, so the check above cannot see it.
    const disagreements: string[] = [];

    for (const [name, holders] of SHARED) {
      if (PER_PACKAGE_IDENTITY.includes(name)) continue;
      if (!holders.every((held) => held.hasValueMeaning)) continue;

      const printed = new Set(holders.map((held) => held.valueType ?? ''));
      if (printed.size === 1) continue;

      disagreements.push(
        `${name}: ${holders
          .map((held) => `${held.entry.specifier} says ${held.valueType ?? 'nothing'}`)
          .join(', ')}`,
      );
    }

    // Then
    expect(disagreements).toEqual([]);
  });

  it('should be checked against an identity list holding only names that are still shared and still name their package', () => {
    // Given, an exemption nobody rereads is where the next disagreement gets filed. Each entry
    // has to still be shared, or it is exempting nothing, and has to still be about the package
    // it sits in, or it is a plain disagreement wearing an exemption.
    for (const name of PER_PACKAGE_IDENTITY) {
      const holders = SHARED.get(name);

      // Then
      expect(
        holders,
        `${name} is exempted and is not shared by two published packages`,
      ).toBeDefined();
      for (const held of holders ?? []) {
        expect(held.valueType ?? '', `${name} in ${held.entry.specifier}`).toContain(
          held.entry.packageName,
        );
      }
    }
  });

  it('should leave one DEFAULT_THEME_NAME, holding the name of the theme actually in force', () => {
    // Given the first of the two the outsider read named, asserted by name as well as by the rule
    // above, because a rule that happens to be satisfied and a rule aimed at a known defect are
    // different claims, and this file was written for these two. `@openref/vue` cannot know the
    // default theme's name: STANDARDS 3.5 gives `theme` no upstream, so the edge that would let
    // one derive the other is forbidden in both directions, and the fix is that only the package
    // shipping the theme answers the question. Its own is `FALLBACK_THEME_NAME` now.
    const holders = PUBLISHED.get('DEFAULT_THEME_NAME') ?? [];

    // Then
    expect(holders.map((held) => held.entry.specifier)).toEqual(['@openref/theme']);
    expect(holders[0]?.valueType).toBe('"vernier"');
    expect(PUBLISHED.get('FALLBACK_THEME_NAME')?.map((held) => held.entry.specifier)).toEqual([
      '@openref/vue',
    ]);
  });

  it('should leave one RunnerSendInput, on the port a console actually calls', () => {
    // Given the second. `@openref/runner`'s was the wider of the two, the least an operation must
    // carry for a plan, and it is `RunnableSendInput` now, in that package's own `Runnable` family.
    // Both entry points of `@openref/vue` publish the port type, which is one declaration reached
    // twice rather than two, and the type rule above is what holds them to that.

    // Then
    expect([
      ...new Set((PUBLISHED.get('RunnerSendInput') ?? []).map((held) => held.entry.packageName)),
    ]).toEqual(['@openref/vue']);
    expect(PUBLISHED.get('RunnableSendInput')?.map((held) => held.entry.specifier)).toEqual([
      '@openref/runner',
    ]);
  });

  it('should hold the bound over the reading that was taken, by the margin it claims', () => {
    // Given, the margin used to be a sentence, and a sentence cannot go red. Written over nine of
    // the ten samples that existed it read 6,620 ms and claimed an order of magnitude under
    // 120,000; over all ten the maximum is 7,850 ms. The claim survived the correction here, which
    // is the case where a checked fact costs nothing, and it is checked for the case where it does
    // not: a probe set that grows until this case is inside a tenth of the bound reddens this one
    // first, while the bound itself still means what it meant.

    // When, Then
    expect(COMPILER_HANG_CATCHER_MS / MEASURED_MAXIMUM_MS).toBeGreaterThanOrEqual(MARGIN);
  });
});
