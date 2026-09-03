/**
 * The first minute of SPEC 2, proved against the packed tarballs rather than against `dist/`.
 *
 * WHY THE TARBALL AND NOT THE WORKSPACE. `first-minute.spec.ts` boots a fixture that imports
 * `packages/nest/dist/index.js` by relative path, which proves the code works and proves nothing
 * about what a consumer receives. npm drops anything outside `files` silently, `exports` decides
 * which of those files a specifier resolves to, and a workspace link bypasses both. Every failure
 * in that gap looks identical to success from inside this repository. The only place it shows is a
 * consumer tree assembled out of what `npm pack` actually produced.
 *
 * WHY NOTHING IS INSTALLED FROM A REGISTRY, AND WHAT THAT COSTS. This suite makes no external
 * request, which is a standing rule, so the consumer tree is built rather than installed: the
 * published packages are packed, unpacked into `node_modules`, and the third party modules they
 * declare are linked from the ones this workspace already resolved. That is what an install would
 * have put there, arrived at without asking anybody for it. What it therefore does not prove is
 * that the registry holds those versions or that their ranges resolve; that is the release job's
 * `pnpm install --frozen-lockfile`, on a clean runner, and it is a different question.
 *
 * WHAT IT DOES PROVE, WHICH IS THE PART THAT WAS UNPROVEN. That the bytes inside the tarballs
 * carry the licence they claim, resolve their own entry points under both module systems, load
 * under `require` with no `ERR_REQUIRE_ESM`, and answer the first minute's one line.
 *
 * WHAT THIS METHOD CANNOT SEE, NAMED HERE BECAUSE A READER MEETS THE METHOD HERE. The first minute
 * cases below are written in plain JavaScript on purpose, so that no compiler and no loader stands
 * between the consumer tree and the thing under test. That decision is correct for what they prove
 * and it is exactly why they are blind to anything only a compiler sees. A published `.d.ts` may
 * import a package that does not exist, and every case written this way passes: the runtime never
 * opens a declaration file. It happened. `@openref/nest`'s `dist/index.d.ts` named `@openref/agent`,
 * `@openref/federation` and `@openref/render`, all three private, from `T039` in M3 until the second
 * blind review of `T064` found it, and this suite was green through all of it.
 *
 * THE METHOD IS NOT CHANGED, A SECOND CHECK IS ADDED, AND BOTH RUN. Rewriting these cases to use a
 * compiler would lose the one thing they exist to prove. So `should typecheck every packed
 * declaration in a tree holding only what a consumer installs` runs `tsc` with `skipLibCheck: false`
 * over all eleven declarations in this same tree, `should go red when a declaration names a package
 * the consumer cannot install` proves that check can fail, and `should name no private workspace
 * package in any shipped file of any tarball` covers the half a compiler still cannot see, which is
 * the JavaScript. SPEC 0 records the class: a check whose method excludes a class of defect by
 * construction is silent about that class, and its silence is indistinguishable from absence.
 */

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

/**
 * The published packages the first minute needs, by workspace directory.
 *
 * `@openref/nest` is the one a reader installs; the other three are the published packages it
 * declares as dependencies, which per SPEC 4 stay external rather than being bundled into it. That
 * rule is exactly what this list exists to exercise: if one of them stopped resolving, the
 * workspace would not notice and a consumer would fail on first import.
 *
 * IT IS FIVE OF ELEVEN AND THE OTHER SIX ARE NOT OUTSIDE THIS FILE, they are outside this tree.
 * Assembling a consumer needs every third party module a package imports linked into place, and
 * six of the eleven are installed by nobody who runs the first minute. What all eleven do owe is
 * their licence text, and that is a fact about the tarball rather than about a consumer tree, so
 * every one of them is packed and read below. See {@link publishedDirectories}.
 */
const PUBLISHED = ['nest', 'core', 'theme', 'vue', 'runner'] as const;

/**
 * Every publishable package directory, read from the manifests rather than listed.
 *
 * THE LIST IS DERIVED BECAUSE THE ASSERTION IS ABOUT COMPLETENESS. A hand written eleven would
 * pass unchanged on the day a twelfth package is published, which is the failure this case exists
 * to catch: SPEC 0's rule is that the licence text travels with the files, and a reader who
 * installs one package never sees this repository. `private` is the same rule `npm publish` uses,
 * so what this returns is what would go out.
 *
 * @returns Workspace directory names of the packages a release publishes, sorted
 */
function publishedDirectories(): string[] {
  const packages = join(REPO_ROOT, 'packages');

  return readdirSync(packages)
    .filter((entry) => {
      try {
        const raw = JSON.parse(readFileSync(join(packages, entry, 'package.json'), 'utf8')) as {
          readonly name?: string;
          readonly private?: boolean;
        };

        return typeof raw.name === 'string' && raw.private !== true;
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * Third party modules the packed packages import, linked from what this workspace resolved.
 *
 * `ts-morph` ARRIVED ON 2026-09-02 WITH THE ERROR CLASS CASE, and it is the CLI's rather than the
 * first minute's: `openref`'s barrel reaches a chunk that imports it, so importing that package
 * inside this tree failed with `ERR_MODULE_NOT_FOUND` until it was here. It is a real dependency
 * a consumer installing `openref` receives, 1.4 MB, and the tree is a poorer model of a consumer
 * without it.
 */
const THIRD_PARTY = [
  '@noble/hashes',
  'isomorphic-dompurify',
  'marked',
  'minisearch',
  'shiki',
  'ts-morph',
  'vue',
  'yaml',
] as const;

/**
 * Peer modules a Nest application supplies, for the load and boot cases.
 *
 * `@nestjs/swagger` is deliberately absent. `packages/nest` does not depend on it and must not
 * start to, per the convention `forroot.spec.ts` states, so the consumer application below writes
 * its document out rather than generating one. What the first minute turns on is the one line.
 */
const FRAMEWORK = [
  '@nestjs/common',
  '@nestjs/core',
  '@nestjs/platform-express',
  'reflect-metadata',
  'rxjs',
  // `@types/node` IS PART OF WHAT A CONSUMER INSTALLS, and it is here for the typecheck rather
  // than for the boot. Without it `skipLibCheck: false` reports `node:stream`, `stream`, `util`
  // and `Buffer` as unresolved out of our declarations and out of `@nestjs/common`'s, which is a
  // statement about this fixture and not about the tarballs. A TypeScript project targeting Node
  // has it; leaving it out would drown the finding this check exists for in six lines of noise.
  '@types/node',
] as const;

/**
 * Where a module named by `from` actually resolves on this machine.
 *
 * NODE'S OWN RESOLVER IS ASKED RATHER THAN A DIRECTORY LIST BEING SEARCHED. pnpm stores every
 * version under `node_modules/.pnpm/<name>@<version>/node_modules/` and links only the edges a
 * package declares, so a transitive dependency is reachable from its own dependent and from
 * nowhere else. Guessing directories finds the shallow half and reports the deep half as absent,
 * which is what the first two attempts at this fixture did.
 *
 * @param from - Directory of the package that names it
 * @param name - Package name, scoped or not
 * @returns Absolute package root, or null when it does not resolve from there
 */
function resolveFrom(from: string, name: string): string | null {
  // THE DIRECTORY IS WALKED BEFORE THE RESOLVER IS ASKED, because what is wanted here is a package
  // root and `exports` has an opinion about entry points rather than about roots. `oniguruma-parser`
  // is the case that made the difference visible: its `exports` map declares subpaths and no `.`,
  // so both `require.resolve('oniguruma-parser')` and `.../package.json` throw
  // ERR_PACKAGE_PATH_NOT_EXPORTED while the directory sits there in plain view.
  let directory = from;
  for (let depth = 0; depth < 24; depth += 1) {
    const candidate = join(directory, 'node_modules', name);
    const manifest = join(candidate, 'package.json');
    if (existsSync(manifest)) {
      const declared = (JSON.parse(readFileSync(manifest, 'utf8')) as { readonly name?: string })
        .name;
      // THE REAL PATH, NOT THE LINK. pnpm puts a symlink here and keeps the package under
      // `node_modules/.pnpm/`, where its own dependencies are linked beside it. Returning the link
      // makes every child of this package unresolvable, because the link's parent chain contains
      // none of them, and the whole subtree then reports as absent.
      if (declared === name) return realpathSync(candidate);
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  const requireFrom = createRequire(join(from, 'resolver.cjs'));

  try {
    return dirname(requireFrom.resolve(`${name}/package.json`));
  } catch {
    // A package whose `exports` map does not expose its own manifest is normal, so fall through
    // to the entry point and walk up to the root that declares the name.
  }

  try {
    let entry = dirname(requireFrom.resolve(name));

    for (let depth = 0; depth < 12; depth += 1) {
      const manifest = join(entry, 'package.json');
      if (existsSync(manifest)) {
        const declared = (JSON.parse(readFileSync(manifest, 'utf8')) as { readonly name?: string })
          .name;
        if (declared === name) return entry;
      }
      const parent = dirname(entry);
      if (parent === entry) break;
      entry = parent;
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Copies a module and everything it declares into the consumer tree.
 *
 * THE CLOSURE IS WALKED RATHER THAN LISTED, because a hand written list is another copy of a fact
 * the manifests already carry, and the first transitive dependency it forgets fails as a missing
 * module rather than as a wrong list. `dependencies` is followed and `devDependencies` is not,
 * which is the edge an installer follows for a dependency of a dependency. An optional dependency
 * that does not resolve is skipped, as an install would skip it.
 *
 * PLACEMENT IS FLAT WHERE IT CAN BE AND NESTED WHERE IT CANNOT, which is npm's own algorithm and
 * is here because the naive version broke on a real conflict rather than in theory. pnpm gives
 * `@nestjs/core` and its siblings different majors of `path-to-regexp`; flattened into one
 * directory the second copy loses, and the boot failed with `pathToRegexp is not a function`. A
 * name already claimed at another version is therefore written into the `node_modules` of the
 * package that asked for it, where Node's resolution finds it first.
 *
 * @param modules - Absolute path of the consumer's `node_modules`
 * @param host - Directory of the already placed package that named this one, which receives a
 *   nested copy when the top level is taken by another version
 * @param from - Directory this name resolves from on this machine
 * @param name - Package name, scoped or not
 * @param placed - Name to version already written at the top level
 * @returns True when the module was found and copied, or was already there
 */
function materialize(
  modules: string,
  host: string,
  from: string,
  name: string,
  placed: Map<string, string>,
): boolean {
  const resolved = resolveFrom(from, name);
  if (resolved === null) return false;

  const manifest = JSON.parse(readFileSync(join(resolved, 'package.json'), 'utf8')) as {
    readonly version?: string;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly optionalDependencies?: Readonly<Record<string, string>>;
  };
  const version = manifest.version ?? '0.0.0';
  const atTop = placed.get(name);

  // Already satisfied at the top level by the same version: nothing to write, and nothing below
  // it to walk, because that copy brought its own closure when it was written.
  if (atTop === version) return true;

  const top = atTop === undefined;
  const target = top ? join(modules, name) : join(host, 'node_modules', name);
  if (top) placed.set(name, version);
  if (existsSync(target)) return true;

  mkdirSync(join(target, '..'), { recursive: true });
  cpSync(resolved, target, { recursive: true, dereference: true });

  const optional = new Set(Object.keys(manifest.optionalDependencies ?? {}));

  for (const edge of Object.keys(manifest.dependencies ?? {})) {
    // A workspace package is already in the tree as its own tarball, and must not be replaced by
    // the linked source: the point of this suite is that the packed bytes are what runs.
    if (edge.startsWith('@openref/')) continue;
    if (!materialize(modules, target, resolved, edge, placed) && !optional.has(edge)) return false;
  }

  return true;
}

let consumer = '';
let packed = '';

/** Package name by workspace directory, filled in as each tarball is unpacked. */
const unpacked = new Map<string, string>();

beforeAll(() => {
  consumer = mkdtempSync(join(tmpdir(), 'openref-consumer-'));
  packed = mkdtempSync(join(tmpdir(), 'openref-tarballs-'));
  const modules = join(consumer, 'node_modules');
  mkdirSync(modules, { recursive: true });

  // EVERY PUBLISHABLE PACKAGE IS PACKED, not only the five the consumer tree needs. What each owes
  // its reader is a licence text inside its own tarball, and until the post T064 review that was
  // asserted for five of eleven while the gate checked the other six in the working tree, which
  // SPEC 0 names explicitly as not the subject.
  for (const directory of publishedDirectories()) {
    const root = join(REPO_ROOT, 'packages', directory);
    const output = execFileSync('npm', ['pack', '--pack-destination', packed, '--silent'], {
      cwd: root,
      encoding: 'utf8',
    });
    const tarball = output.trim().split('\n').at(-1) ?? '';

    const staged = join(packed, directory);
    mkdirSync(staged, { recursive: true });
    execFileSync('tar', ['-xzf', join(packed, tarball), '-C', staged]);

    const name = (
      JSON.parse(readFileSync(join(staged, 'package', 'package.json'), 'utf8')) as {
        readonly name: string;
      }
    ).name;
    unpacked.set(directory, name);

    // ALL ELEVEN GO INTO THE TREE, not the five the first minute needs, because the typecheck below
    // is about every published declaration and a declaration nothing resolves is the defect it
    // exists to find. The other six bring no third party closure with them: the only names their
    // declarations reach for are `vue`, `@nestjs/common` and each other, all of which the walk
    // below already places.
    const target = join(modules, name);
    mkdirSync(join(target, '..'), { recursive: true });
    cpSync(join(staged, 'package'), target, { recursive: true });
  }

  // A module that could not be found is a broken fixture rather than a skipped case: the suite
  // would then be asserting about a tree that is missing something the tarballs import.
  const placed = new Map<string, string>();
  const anchor = join(REPO_ROOT, 'packages', 'nest');
  const unlinked = [...THIRD_PARTY, ...FRAMEWORK].filter(
    (name) => !materialize(modules, consumer, anchor, name, placed),
  );
  if (unlinked.length > 0) {
    throw new Error(
      `the consumer tree could not be assembled: ${unlinked.join(', ')} not resolved`,
    );
  }

  writeFileSync(
    join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'openref-consumer', version: '1.0.0', private: true, type: 'module' }, null, 2)}\n`,
  );
}, SPAWNED_PROCESS_TIMEOUT_MS);

afterAll(() => {
  for (const directory of [consumer, packed]) {
    if (directory !== '') rmSync(directory, { recursive: true, force: true });
  }
});

/**
 * Runs a snippet inside the consumer tree.
 *
 * @param kind - Which module system the snippet is written in
 * @param source - The snippet
 * @returns Trimmed stdout
 */
function runInConsumer(kind: 'module' | 'commonjs', source: string): string {
  return execFileSync(process.execPath, [`--input-type=${kind}`, '-e', source], {
    cwd: consumer,
    encoding: 'utf8',
    timeout: SPAWNED_PROCESS_TIMEOUT_MS,
  }).trim();
}

/**
 * Typechecks a consumer file against the packed declarations, with `skipLibCheck` off.
 *
 * `skipLibCheck` IS THE WHOLE POINT AND IT IS OFF. With it on, `tsc` never opens the `.d.ts` files
 * it resolves, so a declaration importing a package that does not exist is never noticed: the
 * defect this runs for is inside those files rather than in the consumer's own line. It is also
 * why the tree matters. Typechecking in this repository resolves `@openref/render` through the
 * workspace and passes; only a tree holding nothing but the tarballs can tell.
 *
 * @param source - The consumer file to check
 * @returns The diagnostics `tsc` printed, empty when it was clean
 */
function typecheckConsumer(source: string): string {
  writeFileSync(join(consumer, 'check.ts'), source);
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'es2022',
          module: 'nodenext',
          moduleResolution: 'nodenext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: ['node'],
        },
        files: ['check.ts'],
      },
      null,
      2,
    )}\n`,
  );

  const tsc = join(
    dirname(createRequire(join(REPO_ROOT, 'resolver.cjs')).resolve('typescript/package.json')),
    'bin',
    'tsc',
  );

  try {
    execFileSync(process.execPath, [tsc, '--noEmit', '-p', 'tsconfig.json'], {
      cwd: consumer,
      encoding: 'utf8',
      timeout: SPAWNED_PROCESS_TIMEOUT_MS,
    });

    return '';
  } catch (cause) {
    const failure = cause as { readonly stdout?: string; readonly stderr?: string };

    return `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }
}

/**
 * A package the guide tells a reader to install or to import from, with the page that says so.
 *
 * THE POSITION IS THE QUESTION, NOT THE MENTION. `docs/guide/09-security.md` sent a Nuxt host to
 * `@openref/nuxt/runtime`, which is private, and the corrected page still names the package while
 * saying it is not published, because that is the honest thing to write. A check over every mention
 * would refuse the correction along with the defect. So a name counts when it stands after a
 * `from`, after an `import`, after an install command, or inside a fenced block a reader copies.
 *
 * @returns One entry per package named in such a position, across the whole guide
 */
function guidePackagesToInstall(): { readonly file: string; readonly name: string }[] {
  const directory = join(REPO_ROOT, 'docs', 'guide');
  const position =
    /(?:from\s+[`'"]|import\s+[`'"]|(?:npm|pnpm|yarn)\s+(?:i|install|add)\s+(?:[-\w@/.]+\s+)*)(@openref\/[a-z-]+)/g;
  const fenced = /```[\s\S]*?```/g;
  const found: { readonly file: string; readonly name: string }[] = [];

  for (const entry of readdirSync(directory)
    .filter((name) => name.endsWith('.md'))
    .sort()) {
    const text = readFileSync(join(directory, entry), 'utf8');
    const names = [...text.matchAll(position)].map((match) => match[1] ?? '');

    for (const block of text.match(fenced) ?? []) {
      names.push(...[...block.matchAll(/@openref\/[a-z-]+/g)].map((match) => match[0]));
    }

    for (const name of [...new Set(names)].sort()) found.push({ file: entry, name });
  }

  return found;
}

/** Every published package as a consumer would import it, by the name npm installs it under. */
const IMPORTABLE = [
  '@openref/collector-access-control',
  '@openref/collector-casl',
  '@openref/collector-throttler',
  '@openref/core',
  '@openref/nest',
  '@openref/runner',
  '@openref/theme',
  '@openref/theme-kit',
  '@openref/theme-telltale',
  '@openref/vue',
  'openref',
] as const;

/** Shipped file extensions a module specifier can appear in. */
const CODE_EXTENSIONS = ['.js', '.cjs', '.mjs', '.d.ts', '.d.cts', '.d.mts'];

/** A module specifier in a position that is syntax rather than prose. */
const SPECIFIER = /(?:^|[^\w$])(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;

/**
 * Every module specifier a package's shipped files name.
 *
 * COMMENT LINES ARE DROPPED RATHER THAN PARSED AWAY, and the reason is a real match: the CLI's
 * bundle carries a comment that names `@openref/render` while explaining where a resolver lives.
 * A line whose text before the match is a `//` or a block comment continuation is prose, and the
 * alternative, a full JavaScript tokenizer in a test, is a second parser to be wrong in.
 *
 * @param directory - An unpacked tarball's `package` directory
 * @returns Every specifier found, with the file it came from
 */
function specifiersIn(directory: string): { readonly file: string; readonly specifier: string }[] {
  const found: { readonly file: string; readonly specifier: string }[] = [];

  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!CODE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue;

      for (const line of readFileSync(path, 'utf8').split('\n')) {
        for (const match of line.matchAll(SPECIFIER)) {
          const before = line.slice(0, match.index).trimStart();
          if (before.startsWith('//') || before.startsWith('*') || before.startsWith('/*'))
            continue;
          found.push({ file: path.slice(directory.length + 1), specifier: match[1] ?? '' });
        }
      }
    }
  };

  visit(directory);

  return found;
}

describe('a consumer holding only what npm pack produced', () => {
  it('should have every published package unpacked, before anything about them is asserted', () => {
    // Given, a proof of absence needs the subject present. An empty consumer tree would satisfy
    // every case below vacuously.
    const modules = join(consumer, 'node_modules', '@openref');

    // When
    const present = readdirSync(modules).sort();

    // Then
    expect(present).toEqual([
      'collector-access-control',
      'collector-casl',
      'collector-throttler',
      'core',
      'nest',
      'runner',
      'theme',
      'theme-kit',
      'theme-telltale',
      'vue',
    ]);
    expect(existsSync(join(consumer, 'node_modules', 'openref'))).toBe(true);
  });

  it('should have packed all eleven published packages, before the licence case asserts anything', () => {
    // Given, the case below is a proof of absence over a set, so the set has to be present first.
    // Eleven is SPEC 4's eight plus the three ecosystem collectors, and it is asserted as a number
    // rather than derived twice, so a package that quietly stopped being publishable shows here.
    // When
    const packedNames = [...unpacked.values()].sort();

    // Then
    expect(packedNames).toHaveLength(11);
    expect(packedNames).toContain('openref');
    expect(packedNames).toContain('@openref/theme-kit');
    expect(packedNames).toContain('@openref/collector-casl');
  });

  it('should carry the MIT licence text inside every published tarball, all eleven of them', () => {
    // Given, SPEC 0: the text travels with the files. A reader who installs one package never
    // sees this repository, so a licence at the root discharges nothing, and neither does one in
    // the working tree: what a reader receives is the tarball, so the tarball is what is opened.
    const canonical = readFileSync(join(REPO_ROOT, 'LICENSE'), 'utf8');

    // When
    const missing = [...unpacked.keys()].filter((directory) => {
      const path = join(packed, directory, 'package', 'LICENSE');

      return !existsSync(path) || readFileSync(path, 'utf8') !== canonical;
    });

    // Then
    expect(canonical).toContain('MIT License');
    expect(missing).toEqual([]);
  });

  it('should carry that text in the six tarballs no consumer tree here assembles', () => {
    // Given, five of the eleven are unpacked into the consumer tree above and six are not, and it
    // was those six the working tree stood in for. Named rather than counted, so a case that
    // silently stopped reading them cannot report what a clean one does.
    const canonical = readFileSync(join(REPO_ROOT, 'LICENSE'), 'utf8');
    const beyondTheConsumer = [...unpacked.keys()].filter(
      (directory) => !(PUBLISHED as readonly string[]).includes(directory),
    );

    // When
    const read = beyondTheConsumer.map((directory) =>
      readFileSync(join(packed, directory, 'package', 'LICENSE'), 'utf8'),
    );

    // Then
    expect(beyondTheConsumer.sort()).toEqual([
      'cli',
      'collector-access-control',
      'collector-casl',
      'collector-throttler',
      'theme-kit',
      'theme-telltale',
    ]);
    expect(read.every((text) => text === canonical)).toBe(true);
  });

  it(
    'should typecheck every packed declaration in a tree holding only what a consumer installs',
    () => {
      // Given, this is the runner the suite lacked. The rest of the file is deliberately plain
      // JavaScript so that no compiler stands between the consumer tree and the thing under test,
      // which is right for what it proves and is exactly why nothing here could see a declaration
      // naming a package a consumer cannot install. Measured at the post T064 review: `tsc` could
      // not resolve `@openref/agent`, `@openref/federation` or `@openref/render` from
      // `@openref/nest`'s `dist/index.d.ts`, five imports in all, and all three are private.
      const source = IMPORTABLE.map(
        (name, index) => `import * as m${String(index)} from '${name}';\nvoid m${String(index)};`,
      ).join('\n');

      // When
      const diagnostics = typecheckConsumer(source);

      // Then
      expect(diagnostics).toBe('');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should go red when a declaration names a package the consumer cannot install',
    () => {
      // Given, the falsification, run rather than described: one import of a private package is
      // put back into the packed declaration, in the tree, and the check above has to notice. A
      // runner that cannot go red is the thing this whole finding was about.
      const declaration = join(consumer, 'node_modules', '@openref', 'nest', 'dist', 'index.d.ts');
      const held = readFileSync(declaration, 'utf8');
      let diagnostics = '';

      // When
      try {
        writeFileSync(
          declaration,
          `import type { AgentOptions } from '@openref/agent';\nexport type { AgentOptions };\n${held}`,
        );
        diagnostics = typecheckConsumer("import * as m from '@openref/nest';\nvoid m;");
      } finally {
        writeFileSync(declaration, held);
      }

      // Then, the exact diagnostic a consumer would get, naming the package that is not there.
      expect(diagnostics).toContain('@openref/agent');
      expect(diagnostics).toContain('TS2307');
      expect(typecheckConsumer("import * as m from '@openref/nest';\nvoid m;")).toBe('');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it('should name no private workspace package in any shipped file of any tarball', () => {
    // Given, the declaration is one half and the JavaScript is the other, and the second is the
    // worse one: `openref` declared `@openref/render`, `@openref/search` and `@openref/static` as
    // dependencies while all three were private, and its bundle imported two of them by name, so
    // `npm install openref` failed before a line of it ran. A typecheck cannot see that.
    const workspace = join(REPO_ROOT, 'packages');
    const privateNames = readdirSync(workspace).flatMap((entry) => {
      try {
        const raw = JSON.parse(readFileSync(join(workspace, entry, 'package.json'), 'utf8')) as {
          readonly name?: string;
          readonly private?: boolean;
        };

        return raw.private === true && typeof raw.name === 'string' ? [raw.name] : [];
      } catch {
        return [];
      }
    });

    // When
    const named = [...unpacked.keys()].flatMap((directory) =>
      specifiersIn(join(packed, directory, 'package'))
        .filter((found) => privateNames.includes(found.specifier.split('/').slice(0, 2).join('/')))
        .map((found) => `${directory}/${found.file}: ${found.specifier}`),
    );
    const total = [...unpacked.keys()].reduce(
      (sum, directory) => sum + specifiersIn(join(packed, directory, 'package')).length,
      0,
    );

    // Then, an empty sweep is not a clean one: the specifiers have to have been found first.
    expect(privateNames.length).toBeGreaterThanOrEqual(7);
    expect(total).toBeGreaterThan(50);
    expect(named).toEqual([]);
  });

  it(
    'should export the CSP builder the security guide sends a host to, and name no package a host cannot install',
    () => {
      // Given, `docs/guide/09-security.md` told a Nuxt host to import the builder from
      // `@openref/nuxt/runtime`. That package is private by T064's own reversal, so half the
      // sentence sent a reader to something they cannot install, which is the class T063 spent
      // four rounds removing from the documentation. It is not a claim about what a reader sees on
      // a page, so it does not belong in `tools/docs-site/src/claims.ts`, whose own header says it
      // is not a general mechanism; the subject here is what a host can install, and the only place
      // that can be answered is a tree holding nothing but the tarballs.
      const published = new Set<string>(IMPORTABLE);

      // When
      const printed = runInConsumer(
        'module',
        "import { buildContentSecurityPolicy } from '@openref/nest';" +
          "process.stdout.write(buildContentSecurityPolicy('abc'));",
      );
      const named = guidePackagesToInstall();
      const uninstallable = named.filter((found) => !published.has(found.name));

      // Then, the export is where the guide says it is, and every package the guide sends a reader
      // to install or import from is one they can install. An empty sweep is not a clean one: the
      // names have to have been found first.
      expect(printed).toContain("default-src 'none'");
      expect(printed).toContain('nonce-abc');
      expect(named.length).toBeGreaterThanOrEqual(4);
      expect(uninstallable.map((found) => `${found.file}: ${found.name}`)).toEqual([]);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it('should load under ESM and expose the one line of the first minute', () => {
    // Given
    const source =
      "import { OpenRefModule } from '@openref/nest';" +
      'process.stdout.write(typeof OpenRefModule.setup);';

    // When
    const printed = runInConsumer('module', source);

    // Then
    expect(printed).toBe('function');
  });

  it('should load under require with no ERR_REQUIRE_ESM, per SPEC 23', () => {
    // Given, this is the failure SPEC 23 calls inadmissible, and it is a fact about the packed
    // `exports` map rather than about the source: a `require` condition pointing at an ESM file
    // fails here and nowhere in the workspace.
    const source =
      "const { OpenRefModule } = require('@openref/nest');" +
      'process.stdout.write(typeof OpenRefModule.setup);';

    // When
    const printed = runInConsumer('commonjs', source);

    // Then
    expect(printed).toBe('function');
  });

  it('should resolve every published dependency it declares rather than bundling a second copy', () => {
    // Given, SPEC 4's rule: a published package declared as a dependency of another published one
    // stays external. A consumer proves it by resolving each name from inside the installed tree.
    const source =
      "const names = ['@openref/core', '@openref/vue', '@openref/runner'];" +
      'process.stdout.write(names.map((n) => require.resolve(n) !== undefined).join(","));';

    // When
    const printed = runInConsumer('commonjs', source);

    // Then
    expect(printed).toBe('true,true,true');
  });

  it(
    'should reproduce the first minute: one line mounts a reference that answers 200',
    () => {
      // Given, SPEC 2's whole promise, written the way a reader writes it, against the tarball.
      writeFileSync(
        join(consumer, 'app.mjs'),
        [
          // The decorators are applied by hand for the reason `first-minute-app.mjs` gives: this is
          // plain JavaScript so that no compiler or loader stands between the consumer tree and the
          // thing under test, and the calls below are exactly what the decorator syntax does.
          "import 'reflect-metadata';",
          "import { Controller, Get, Module } from '@nestjs/common';",
          "import { NestFactory } from '@nestjs/core';",
          "import { OpenRefModule } from '@openref/nest';",
          '',
          'class OrdersController {',
          '  list() {',
          "    return [{ id: 'ord_1024' }];",
          '  }',
          '}',
          '',
          "Get()(OrdersController.prototype, 'list', Object.getOwnPropertyDescriptor(OrdersController.prototype, 'list'));",
          "Controller('orders')(OrdersController);",
          '',
          'class AppModule {}',
          'Module({ controllers: [OrdersController] })(AppModule);',
          '',
          'const app = await NestFactory.create(AppModule, { logger: false });',
          "OpenRefModule.setup('/docs', app, {",
          '  document: {',
          "    openapi: '3.1.0',",
          "    info: { title: 'Orders', version: '1.0.0' },",
          "    servers: [{ url: '/' }],",
          '    paths: {',
          "      '/orders': {",
          "        get: { operationId: 'listOrders', responses: { 200: { description: 'Orders' } } },",
          '      },',
          '    },',
          '  },',
          '});',
          "await app.listen(0, '127.0.0.1');",
          'const { port } = app.getHttpServer().address();',
          'const response = await fetch(`http://127.0.0.1:${port}/docs`);',
          'const body = await response.text();',
          'process.stdout.write(JSON.stringify({ status: response.status, ok: body.includes("oref-app") }));',
          'await app.close();',
          '',
        ].join('\n'),
      );

      // When
      const printed = execFileSync(process.execPath, ['app.mjs'], {
        cwd: consumer,
        encoding: 'utf8',
        timeout: SPAWNED_PROCESS_TIMEOUT_MS,
      }).trim();

      // Then
      expect(JSON.parse(printed)).toEqual({ status: 200, ok: true });
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
  it(
    'should hand a consumer every error class its packages can throw, as the class the throw site used',
    () => {
      // Given the five published packages that raise an `OpenRefError`, and every class each one
      // exports. Until 2026-09-02 the three runtime packages exported ONE between them, while
      // `noStreamTransport()` had `RunnerError` as its declared return type and dozens of `@throws`
      // tags named classes a consumer could not import.
      //
      // IDENTITY IS WHAT THIS PROVES AND A WORKSPACE CANNOT. A re-export is worth nothing if
      // `@openref/core` were bundled into the package's `dist`: the exported constructor and the
      // constructor the throw site uses would be two functions, and `instanceof` would answer false
      // for every error the package ever throws while every name check stayed green.
      const packages = [
        '@openref/nest',
        '@openref/runner',
        '@openref/vue',
        'openref',
        '@openref/theme-kit',
      ];
      const source = [
        "import { OpenRefError, ErrorCode } from '@openref/core';",
        `const names = ${JSON.stringify(packages)};`,
        'const failures = [];',
        'let checked = 0;',
        'for (const name of names) {',
        '  const loaded = await import(name);',
        '  for (const [key, value] of Object.entries(loaded)) {',
        '    if (!key.endsWith("Error") || typeof value !== "function") continue;',
        '    checked += 1;',
        '    const thrown = new value("probe", ErrorCode.CONFIG_INVALID_OPTIONS);',
        '    if (!(thrown instanceof OpenRefError)) failures.push(`${name}: ${key} is not the core class`);',
        '    if (!(thrown instanceof value)) failures.push(`${name}: ${key} is not an instance of itself`);',
        // A class with a fixed code of its own, as `ElementTooLargeError` has, ignores the one
        // handed in. What every one of them owes is a code from the published set, which is the
        // rule STANDARDS states and the rule that class was breaking until it was fixed.
        '    if (!Object.values(ErrorCode).includes(thrown.code)) failures.push(`${name}: ${key} carries no ErrorCode`);',
        '  }',
        '}',
        'process.stdout.write(JSON.stringify({ failures, checked }));',
      ].join('\n');

      // When
      const printed = JSON.parse(runInConsumer('module', source)) as {
        failures: string[];
        checked: number;
      };

      // Then, a proof of absence over nothing is worth nothing, so the count is asserted too
      expect(printed.failures).toEqual([]);
      expect(printed.checked).toBeGreaterThan(25);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should let a consumer switch exhaustively over ErrorCode with no default branch',
    () => {
      // Given the thirty members read off the packed declaration rather than restated here. Under
      // the `declare enum` this shipped as until 2026-09-02 the case labels below did not compile
      // at all: the compiler reported the literal and the enum type as having no overlap, so the
      // only `switch` a consumer could write carried a `default`, and a `default` is where a code
      // added in a minor version goes to be handled as something else.
      const declarations = readFileSync(
        join(consumer, 'node_modules', '@openref', 'core', 'dist', 'index.d.ts'),
        'utf8',
      );
      const block = /declare const ErrorCode:\s*\{([\s\S]*?)\n\};/.exec(declarations);
      expect(block, 'the packed core does not declare ErrorCode as an object').not.toBeNull();
      const members = [...(block?.[1] ?? '').matchAll(/^\s{4}readonly ([A-Z_]+):/gm)].map(
        (match) => match[1] ?? '',
      );
      expect(members.length).toBe(30);

      const arms = members.map((member) => `    case '${member}': return '${member}';`).join('\n');

      // When, the same switch twice: over the union as published, and over the union plus one more
      // member, which is what a minor version adding a code does to that consumer
      const exhaustive = typecheckConsumer(
        [
          "import type { ErrorCode } from '@openref/core';",
          'export function label(code: ErrorCode): string {',
          '  switch (code) {',
          arms,
          '  }',
          '}',
          "export const literal: ErrorCode = 'NORM_REF_UNRESOLVED';",
        ].join('\n'),
      );
      const grown = typecheckConsumer(
        [
          "import type { ErrorCode } from '@openref/core';",
          "export function label(code: ErrorCode | 'NORM_A_THIRTY_FIRST_CODE'): string {",
          '  switch (code) {',
          arms,
          '  }',
          '}',
        ].join('\n'),
      );

      // Then
      expect(exhaustive).toBe('');
      expect(grown).toContain('error TS');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});
