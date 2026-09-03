/**
 * Every error class a published declaration promises has to be importable from that package.
 *
 * WHAT WAS WRONG BEFORE 2026-09-02. `@openref/nest`, `@openref/runner` and `@openref/vue`
 * exported one error class between them, `ElementTooLargeError`, and it was the one that had
 * broken the project's own error rule. Meanwhile `noStreamTransport()` in `@openref/runner` had
 * `RunnerError` as its DECLARED RETURN TYPE and dozens of `@throws` tags across the three named
 * classes a consumer could not import. The type told them the class existed and the package gave
 * them no way to name it, so every `catch` needed a second dependency on `@openref/core` that
 * nothing on those surfaces mentioned. A consumer cannot catch what they cannot import.
 *
 * THE RULE IS DERIVED FROM THE ARTEFACT AND NOT LISTED. Every name in a `@throws` tag or a
 * declared type inside a package's shipped `dist/index.d.ts`, whose base chain reaches
 * `OpenRefError`, must be exported by that same package. The hierarchy is read off
 * `@openref/core`'s own declarations rather than restated, so a class added there is in this check
 * from the moment it exists, and the published set comes from the manifests through the same
 * derivation the `publish-list` gate uses.
 *
 * THE TWO HALVES THAT NEED A TARBALL LIVE WHERE THE TARBALLS ALREADY ARE, AND THIS FILE PACKS
 * NOTHING. `packages/nest/test/integration/published-consumer.spec.ts` assembles a consumer tree
 * out of all eleven tarballs, and the claims that need one are cases there: that every exported
 * class can be imported and is the class the throw site used, which is what `instanceof` answers
 * false for when a package bundles its own copy of `@openref/core`, and that a consumer can
 * switch exhaustively over `ErrorCode` with no `default`. A second packing pass here raced the
 * first, which is why there is not one: two `npm pack` runs in one package directory, in two
 * vitest projects at once, with a CLI suite spawning that package's artefact in between.
 *
 * A MISSING BUILD IS A FAILURE AND NEVER A SKIP, and an empty read cannot pass: the subject list
 * is asserted non-empty and asserted to hold the three packages the finding named.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { readWorkspaceManifests, resolveShippedPackages } from '../../src/lib/workspace';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

/** A `@throws {SomeError}` tag, which is where a declaration promises a class by name. */
const THROWS_TAG = /@throws\s+\{([A-Za-z]+Error)\}/g;

/** A declared type naming a class: a return type, a member type, a parameter. */
const DECLARED_TYPE = /(?::|=>)\s*([A-Za-z]+Error)\b/g;

/** Names JavaScript itself gives every consumer, so a package owes no export for one. */
const GLOBAL_ERRORS: readonly string[] = [
  'AggregateError',
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
];

/** One published package, with what its declarations name and where its manifest lives. */
interface Subject {
  readonly name: string;
  readonly directory: string;
  /** Names of `OpenRefError` classes the published declarations promise, sorted. */
  readonly promised: readonly string[];
  /** Error class names the published declarations export, sorted. */
  readonly exported: readonly string[];
  /** Names ending in `Error` that the declarations promise and that are not classes, sorted. */
  readonly notClasses: readonly string[];
}

/**
 * Exports this file could not read a declaration for, as `<package>: <name>`.
 *
 * COUNTED RATHER THAN SKIPPED, because a name that cannot be read is a name that leaves the
 * comparison, and a comparison that quietly shrinks is a failure mode this whole file is about.
 */
const unresolved: string[] = [];

/**
 * The classes a consumer could ever be asked to catch, read off a declaration file.
 *
 * DERIVED AND NOT LISTED, because a hand written set of twenty five names is a set that agrees
 * with the hierarchy until somebody adds a class. Anything whose base chain reaches
 * `OpenRefError` is in, and everything else that happens to end in `Error` is out: `TypeError`
 * and `RangeError` are globals a consumer already has, and `FederationStateError` is a plain data
 * record describing a remote's last failure, which is a member type rather than something to
 * catch. Both kinds are counted separately below rather than filtered in silence.
 *
 * @param declarations - Absolute path to a `.d.ts`
 * @param known - Classes already established as part of the hierarchy, for a file that extends one
 *   it imports rather than one it declares
 * @returns Every class in that file whose base chain reaches `OpenRefError`
 */
function errorClassesIn(declarations: string, known: ReadonlySet<string> = new Set()): Set<string> {
  const text = readFileSync(declarations, 'utf8');
  const parents = new Map<string, string>();
  for (const match of text.matchAll(/declare class ([A-Za-z]+) extends ([A-Za-z]+)/g)) {
    parents.set(match[1] ?? '', match[2] ?? '');
  }

  const reaches = (name: string): boolean => {
    for (let current = name, hops = 0; hops < 20; hops += 1) {
      if (current === 'OpenRefError' || known.has(current)) return true;
      const parent = parents.get(current);
      if (parent === undefined) return false;
      current = parent;
    }

    return false;
  };

  return new Set([...parents.keys()].filter((name) => reaches(name) || name === 'OpenRefError'));
}

/** The `OpenRefError` hierarchy, as `@openref/core`'s own declarations state it. */
const CORE_ERROR_CLASSES = errorClassesIn(
  join(REPO_ROOT, 'packages', 'core', 'dist', 'index.d.ts'),
);

/**
 * Every name a declaration file exports, read through the compiler rather than by pattern.
 *
 * `export *`, `export { x as y }` and a re-export through a content hashed chunk are one question
 * to the checker and three patterns to a scanner. The resolution settings are load bearing:
 * `@openref/nest` re-exports names from `@openref/core`, and under the compiler's default
 * resolution those aliases have no declaration behind them and would silently disappear.
 *
 * @param declarations - Absolute path to a `.d.ts`
 * @param label - Package name, for the unresolved report
 * @returns The exported names
 */
function exportedNames(declarations: string, label: string): string[] {
  const program = ts.createProgram([declarations], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(declarations);
  if (file === undefined) throw new Error(`${declarations} did not parse`);

  const symbol = checker.getSymbolAtLocation(file);
  if (symbol === undefined) throw new Error(`${declarations} is not a module`);

  const names: string[] = [];
  for (const exported of checker.getExportsOfModule(symbol)) {
    const resolved =
      (exported.flags & ts.SymbolFlags.Alias) === 0 ? exported : checker.getAliasedSymbol(exported);
    if (resolved.getDeclarations()?.[0] === undefined) {
      unresolved.push(`${label}: ${exported.getName()}`);
      continue;
    }
    names.push(exported.getName());
  }

  return names;
}

/** The published packages whose declarations name at least one error class. */
function readSubjects(): Subject[] {
  const manifests = readWorkspaceManifests(REPO_ROOT);
  const { published } = resolveShippedPackages(manifests);
  const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
  const found: Subject[] = [];

  for (const name of published) {
    const directory = join(REPO_ROOT, byName.get(name)?.directory ?? '');
    const declarations = join(directory, 'dist', 'index.d.ts');
    if (!existsSync(declarations)) {
      throw new Error(
        `${name} has no dist/index.d.ts. Run pnpm build; a missing artifact is not a pass`,
      );
    }

    const text = readFileSync(declarations, 'utf8');
    const named = new Set<string>();
    for (const match of text.matchAll(THROWS_TAG)) named.add(match[1] ?? '');
    for (const match of text.matchAll(DECLARED_TYPE)) named.add(match[1] ?? '');
    if (named.size === 0) continue;

    // Its own classes count too: `ElementTooLargeError` is declared in `@openref/runner` and
    // extends `StreamError`, so it is a class a consumer catches and is not in core's own file.
    const classes = new Set([
      ...CORE_ERROR_CLASSES,
      ...errorClassesIn(declarations, CORE_ERROR_CLASSES),
    ]);
    const byOrder = (left: string, right: string): number => left.localeCompare(right);

    found.push({
      name,
      directory,
      promised: [...named].filter((candidate) => classes.has(candidate)).sort(byOrder),
      exported: exportedNames(declarations, name)
        .filter((exportedName) => classes.has(exportedName))
        .sort(byOrder),
      notClasses: [...named].filter((candidate) => !classes.has(candidate)).sort(byOrder),
    });
  }

  return found;
}

const SUBJECTS = readSubjects();

describe('the error classes the published packages promise', () => {
  it('should be a set this tree actually has, so the checks below cannot pass over nothing', () => {
    // Given, a proof that nothing is unimportable is green over an empty subject list, which is
    // what an unbuilt tree and a broken regular expression both produce.

    // Then
    expect(CORE_ERROR_CLASSES.size).toBeGreaterThan(20);
    expect([...CORE_ERROR_CLASSES]).toContain('RunnerError');
    expect(SUBJECTS.length).toBeGreaterThan(3);
    expect(SUBJECTS.map((subject) => subject.name)).toContain('@openref/runner');
    expect(SUBJECTS.map((subject) => subject.name)).toContain('@openref/vue');
    expect(SUBJECTS.map((subject) => subject.name)).toContain('@openref/nest');
    expect(SUBJECTS.find((subject) => subject.name === '@openref/runner')?.promised).toContain(
      'RunnerError',
    );
    expect(SUBJECTS.find((subject) => subject.name === '@openref/vue')?.promised).toContain(
      'ThemeContractError',
    );
    expect(unresolved).toEqual([]);
  });

  it('should every one be exported by the package whose declarations promise it', () => {
    // Given each package's own declaration file, which is what a consumer's editor reads
    const missing = SUBJECTS.flatMap((subject) =>
      subject.promised
        .filter((promised) => !subject.exported.includes(promised))
        .map((promised) => `${subject.name} promises ${promised} and does not export it`),
    );

    // Then
    expect(missing).toEqual([]);
  });

  it('should account for every name it did not require, rather than filtering one away in silence', () => {
    // Given, the filter is where this check would go blind: a class dropped from the hierarchy, or
    // a regular expression that stopped matching, would empty `promised` and leave the assertion
    // above green. So every name ending in `Error` that the declarations promise and that was NOT
    // required is asked to be one of two things a package genuinely owes no export for: a global
    // JavaScript already gives the consumer, or a record declared in that same file.
    const unexplained = SUBJECTS.flatMap((subject) => {
      const text = readFileSync(join(subject.directory, 'dist', 'index.d.ts'), 'utf8');

      return subject.notClasses
        .filter(
          (name) =>
            !GLOBAL_ERRORS.includes(name) &&
            !new RegExp(`(?:declare )?interface ${name}\\b`).test(text) &&
            !new RegExp(`(?:declare )?type ${name}\\b`).test(text),
        )
        .map((name) => `${subject.name}: ${name} is neither a global nor a declared record`);
    });

    // Then
    expect(unexplained).toEqual([]);
    expect(SUBJECTS.flatMap((subject) => subject.notClasses).length).toBeGreaterThan(0);
  });
});
