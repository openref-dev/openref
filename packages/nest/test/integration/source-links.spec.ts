import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expandSourceLink, type IROperation, type IRSourceLocation } from '@openref/core';
import { sourceCollector } from '../../src/runtime/infrastructure/collectors/source.collector';
import { closeFunctionLocator } from '../../src/runtime/infrastructure/adapters/function-location.adapter';
import { findRepositoryRoot } from '../../src/runtime/infrastructure/adapters/repository.adapter';
import type { CollectorContext } from '../../src/runtime/application/ports/collector.port';
import type { ControllerLike, HandlerLike } from '../../src/shared/types/nest-surface';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * T018's done-when, stated as a test: every operation in the example app links to its real source
 * line.
 *
 * IT RUNS INSIDE THE EXAMPLE PROJECT, AGAINST ITS BUILT OUTPUT, and that is the whole point of
 * doing it here rather than in the unit suite. The unit tests locate handlers in `.ts` files that
 * Vite transformed, which proves the mechanism; this proves the shape a consumer actually deploys:
 * `tsc` output in `dist/`, loaded through the built `@openref/nest` from that project's own
 * `node_modules`, with the line read back through a `.js.map` written beside the JavaScript.
 *
 * THE LINE IS CHECKED AGAINST THE SOURCE FILE RATHER THAN AGAINST A NUMBER. A recorded line
 * number would be a test somebody updates without reading whenever the controller moves. Reading
 * the file the link points at and requiring the named method to be on the named line is the same
 * claim, checked rather than remembered, and it is exactly what a reader who clicks the link gets.
 *
 * THIS IS ALSO THE CHECK THAT `sourceMap: true` IS STILL SET in the example's `tsconfig.json`.
 * Turning it off does not break the build, does not break the boot, and does not empty the panel:
 * it silently turns every link into a link to a file. That is the failure this file exists to
 * catch, and it fails on the line assertion rather than on the presence of a link.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const example = join(repoRoot, 'examples', 'nest-minimal');
const compat = join(repoRoot, 'compat', 'nest10-cjs');

/** What the booted example reports back about itself. */
interface Report {
  readonly template?: string;
  readonly sources: readonly (IRSourceLocation & { readonly id: string })[];
  readonly operations: number;
  readonly problems: readonly { readonly subject: string; readonly reason: string }[];
}

/**
 * The program run inside the example project.
 *
 * IT ASKS THE CONTAINER RATHER THAN THE HTTP SURFACE, because the surface that shows a source
 * link is T023's and does not exist yet. `OPENREF_REFERENCES` is the provider `forRoot` registers
 * and it holds the pass, which is public API of this package for exactly this kind of reader.
 */
const PROGRAM = `
import { createApp } from './dist/main.js';
import { OPENREF_REFERENCES } from '@openref/nest';

const app = await createApp('express');
const references = app.get(OPENREF_REFERENCES, { strict: false });
const mounted = references.all()[0];
const document = mounted.pass.document;

const sources = [];
let operations = 0;
for (const [id, node] of document.nodes) {
  if (node.kind !== 'operation') continue;
  operations += 1;
  if (node.runtime?.source !== undefined) sources.push({ id, ...node.runtime.source });
}

process.stdout.write(
  JSON.stringify({
    template: document.runtime?.sourceLinkTemplate,
    sources,
    operations,
    problems: mounted.pass.pairing.routesWithoutNode,
  }),
);

await app.close();
`;

/**
 * The one boot of each arm, kept because booting a NestJS application is this file's whole cost.
 *
 * ADDED WHEN THE COVERAGE GATE WENT RED AND NOTHING ELSE DID. The program takes no input and only
 * reads, so a second boot pays the first one's price to answer the same question. Seven spawns
 * across this file and `runtime-facts.spec.ts` sat inside vitest's five second default until the
 * example gained a throttler and three more collectors, and then two cases here timed out under
 * the coverage run, which is the only run that takes the integration suite and V8 instrumentation
 * together. Session 22's fourth breakage is the same shape, and the honest repair is the same:
 * remove the work rather than raise the bound.
 *
 * REMOVING THE WORK WAS NOT THE WHOLE ANSWER, AND THE SECOND HALF ARRIVED AS F25's SECOND PART.
 * One boot is still a boot, and this file went red once more on an unchanged commit with the next
 * two runs green. Every case below therefore declares {@link SPAWNED_PROCESS_TIMEOUT_MS}, which is
 * the bound for a case whose cost is a child process rather than its assertion. The default is
 * untouched, so a timeout anywhere else in the suite still means what it always meant.
 */
let cached: Report | undefined;

/**
 * Boots the example and reads its report.
 *
 * @returns What the application said about its own sources
 */
function report(): Report {
  if (cached !== undefined) return cached;

  if (!existsSync(join(example, 'dist', 'main.js'))) {
    throw new Error('examples/nest-minimal is not built. Run pnpm build; a skip is not a pass');
  }

  const printed = execFileSync(process.execPath, ['--input-type=module', '-e', PROGRAM], {
    cwd: example,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  cached = JSON.parse(printed) as Report;

  return cached;
}

/**
 * Reads a line out of a file in this repository.
 *
 * @param file - Repository relative path
 * @param line - One based line number
 * @returns The line, trimmed
 */
function lineAt(file: string, line: number): string {
  return (
    execFileSync('sed', ['-n', `${String(line)}p`, join(repoRoot, file)], {
      encoding: 'utf8',
    }).trim() || ''
  );
}

describe('the example app', () => {
  it(
    'should give every operation a source with a repository relative file and a line',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given the built example, booted as a consumer boots it
      const found = report();

      // Then every operation has one, and nothing is left over
      expect(found.operations).toBeGreaterThan(0);
      expect(found.sources).toHaveLength(found.operations);
      expect(found.problems).toEqual([]);

      for (const source of found.sources) {
        expect(source.controller).toBe('OrdersController');
        expect(source.file).toBe('examples/nest-minimal/src/orders.controller.ts');
        expect(source.file?.startsWith('/')).toBe(false);
        expect(source.line).toBeGreaterThan(0);
      }
    },
  );

  it(
    'should put each line on the method it names, read back out of the file',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given. This is the assertion `sourceMap: false` fails, and the only one that does: without
      // the map every link would still be produced, pointing at `dist/serve.js`.
      const found = report();

      // When, Then
      for (const source of found.sources) {
        expect(source.file).toBeDefined();
        expect(source.line).toBeDefined();

        const text = lineAt(source.file ?? '', source.line ?? 0);
        expect(text.startsWith(`${source.handler}(`)).toBe(true);
      }
    },
  );

  it(
    'should expand every source into a link with the revision this build was made from',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given
      const found = report();

      // Then the template has had `{ref}` filled in from git, so what is left is per node
      expect(found.template).toBeDefined();
      expect(found.template).not.toContain('{ref}');
      expect(found.template).toMatch(
        /^https:\/\/github\.com\/[^/]+\/openref\/blob\/[0-9a-f]{40}\//,
      );

      for (const source of found.sources) {
        const link = expandSourceLink(found.template ?? '', source);

        expect(link.reason).toBeUndefined();
        expect(link.withoutLine).toBeUndefined();
        expect(link.url).toContain('/examples/nest-minimal/src/orders.controller.ts#L');
        expect(link.url).not.toContain('NaN');
        expect(link.url).not.toContain('{');
      }
    },
  );
});

/**
 * The program the CommonJS arm runs, which is the same questions in the other module system.
 *
 * `createRequire` is not needed: `--input-type=commonjs` gives this a real `require`, resolving
 * from `compat/nest10-cjs`, which is where its own NestJS 10 and its own copy of the built package
 * are. That is the point of running it there.
 */
const CJS_PROGRAM = `
const { createApp } = require('./dist/serve.js');
const { OPENREF_REFERENCES } = require('@openref/nest');

createApp('express').then(async (app) => {
  const references = app.get(OPENREF_REFERENCES, { strict: false });
  const document = references.all()[0].pass.document;

  const sources = [];
  let operations = 0;
  for (const [id, node] of document.nodes) {
    if (node.kind !== 'operation') continue;
    operations += 1;
    if (node.runtime && node.runtime.source) sources.push({ id, ...node.runtime.source });
  }

  process.stdout.write(JSON.stringify({
    template: document.runtime && document.runtime.sourceLinkTemplate,
    sources,
    operations,
    problems: references.all()[0].pass.pairing.routesWithoutNode,
  }));

  await app.close();
});
`;

/** The CommonJS arm's one boot, cached for the reason {@link cached} gives. */
let cachedCjs: Report | undefined;

/**
 * Boots the NestJS 10 CommonJS fixture and reads its report.
 *
 * @returns What that application said about its own sources
 */
function cjsReport(): Report {
  if (cachedCjs !== undefined) return cachedCjs;

  if (!existsSync(join(compat, 'dist', 'serve.js'))) {
    throw new Error('compat/nest10-cjs is not built. Run pnpm build; a skip is not a pass');
  }

  const printed = execFileSync(process.execPath, ['--input-type=commonjs', '-e', CJS_PROGRAM], {
    cwd: compat,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  cachedCjs = JSON.parse(printed) as Report;

  return cachedCjs;
}

describe('the NestJS 10 CommonJS arm, which is built with no source maps', () => {
  it(
    'should locate a handler on CommonJS, where V8 names a script by path not by url',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given the other arm of the SPEC 23 matrix. The example is ESM and its scripts arrive as
      // `file:` urls; a CommonJS module arrives as a plain absolute path, which is a branch of the
      // locator that nothing else in the suite reaches.
      // When
      const found = cjsReport();

      // Then the class and the method are named, and the file is the compiled one, because that is
      // where the code is when nothing said otherwise
      expect(found.operations).toBeGreaterThan(0);
      expect(found.sources).toHaveLength(found.operations);

      for (const source of found.sources) {
        expect(source.controller).toBe('OrdersController');
        expect(source.file).toBe('compat/nest10-cjs/dist/serve.js');
        expect(source.file?.startsWith('/')).toBe(false);
      }
    },
  );

  it(
    'should point the line at the emitted file, since with no map the script is the source',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given the same boot. WITHOUT A SOURCE MAP THERE IS NOTHING TO TRANSLATE AND NOTHING IS
      // GUESSED: the file this arm reports is the JavaScript, so the line it reports is a line of
      // that JavaScript, and the two agree. The dishonest answer would be a TypeScript line number
      // taken from a JavaScript file, and the empty answer would be a file link where a precise one
      // was available. This asserts the pair by reading the line the link points at.
      const found = cjsReport();

      // When
      const links = found.sources.map((source) => expandSourceLink(found.template ?? '', source));

      // Then
      for (const source of found.sources) {
        expect(lineAt(source.file ?? '', source.line ?? 0)).toContain(`${source.handler}(`);
      }

      for (const link of links) {
        expect(link.withoutLine).toBeUndefined();
        expect(link.url).not.toContain('NaN');
        expect(link.url).toContain('/compat/nest10-cjs/dist/serve.js#L');
      }
    },
  );
});

/**
 * `T018-R1`'s first done-when: the editor form, proven where the forge form cannot exist.
 *
 * IT RUNS OUTSIDE ANY REPOSITORY, WHICH IS THE WHOLE POINT. Everything else in this file boots a
 * project inside this checkout, so `{ref}` resolves, `{file}` is relative to a root that exists,
 * and a link that quietly depended on git would still pass. A temporary directory has no `.git`
 * above it at all, so what is left is exactly what SPEC 6.3 says the editor form needs: the file,
 * the line and the column, out of the source map and nothing else.
 *
 * THE FILES ARE WRITTEN RATHER THAN FIXTURES, because a fixture committed to this repository is
 * inside this repository, which is the one property the case is about.
 */

/** Base64 digits of the VLQ encoding a source map's `mappings` field is written in. */
const VLQ_DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Encodes one number the way a source map does.
 *
 * WRITTEN OUT RATHER THAN A RECORDED STRING, so the case states the line and the column it maps
 * to and a reader can check the claim without decoding anything.
 *
 * @param value - The number, which is a delta in every field but the first
 * @returns Its base64 VLQ digits
 */
function vlq(value: number): string {
  let remaining = value < 0 ? (-value << 1) | 1 : value << 1;
  let encoded = '';

  do {
    const digit = remaining & 31;
    remaining >>>= 5;
    encoded += VLQ_DIGITS.charAt(remaining > 0 ? digit | 32 : digit);
  } while (remaining > 0);

  return encoded;
}

/** The original file's one based line and column that the map points the handler at. */
const ORIGINAL_LINE = 41;
const ORIGINAL_COLUMN = 3;

/** The original TypeScript, whose line 41 column 3 is where `findAll` is written. */
const ORIGINAL = [
  ...Array.from(
    { length: 38 },
    (_value: unknown, index: number) => `// filler line ${String(index + 1)}`,
  ),
  'export class OrdersController {',
  '  /** Lists orders. */',
  '  findAll(): string {',
  "    return 'orders';",
  '  }',
  '}',
  '',
].join('\n');

/**
 * The emitted JavaScript, whose third line holds the method.
 *
 * COMMONJS BECAUSE IT IS LOADED WITH `require`, which keeps the module out of the test runner's
 * own transform pipeline: this case is about what V8 reports for a file on disk, and a file the
 * runner rewrote would be a case about the runner.
 */
const COMPILED = [
  "'use strict';",
  'class OrdersController {',
  '  findAll() {',
  "    return 'orders';",
  '  }',
  '}',
  'module.exports = { OrdersController };',
  '//# sourceMappingURL=orders.controller.cjs.map',
  '',
].join('\n');

/**
 * A collector context for one method, with everything the source collector does not read left
 * inert.
 *
 * @param controller - The class the handler is written on
 * @param handlerName - The method name, as the prototype holds it
 * @param handler - The method itself
 * @returns The context, as the registry would build it
 */
function contextFor(
  controller: ControllerLike,
  handlerName: string,
  handler: HandlerLike,
): CollectorContext {
  const node: IROperation = {
    kind: 'operation',
    id: 'OrdersController_findAll',
    method: 'get',
    path: '/orders',
    tags: [],
    deprecated: false,
    parameters: [],
    responses: [],
    security: [],
    servers: [],
  };

  return {
    node,
    controller,
    declaredOn: controller,
    handler,
    handlerName,
    reflector: { get: () => undefined, getAllAndOverride: () => undefined },
    moduleRef: { get: () => undefined },
    globalGuards: [],
    globalPipes: [],
    fact: (value, confidence) => ({ value, confidence, collector: 'sourceCollector' }),
  };
}

/** What one run of the collector over the written files produced. */
interface OutsideRepository {
  readonly directory: string;
  readonly source: IRSourceLocation | undefined;
  readonly problems: readonly { readonly subject: string; readonly reason: string }[];
}

/**
 * Writes a compiled handler, its map and its original outside any repository, and collects it.
 *
 * @param absolutePath - Whether the host opted in to the absolute path, per SPEC 6.3
 * @returns The directory, the location the collector produced, and what it could not resolve
 */
function outsideRepository(absolutePath: boolean): OutsideRepository {
  // THE REAL PATH AND NOT THE ONE `mkdtemp` HANDED BACK. On macOS the temporary directory is
  // reached through a symlink, `require` resolves it, and V8 reports the resolved script. What an
  // editor is handed has to be the path that exists, so this is the answer the case wants.
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'openref-editor-link-')));

  const compiled = join(directory, 'orders.controller.cjs');
  writeFileSync(join(directory, 'orders.controller.ts'), ORIGINAL, 'utf8');
  writeFileSync(compiled, COMPILED, 'utf8');
  writeFileSync(
    join(directory, 'orders.controller.cjs.map'),
    JSON.stringify({
      version: 3,
      file: 'orders.controller.cjs',
      sources: ['orders.controller.ts'],
      names: [],
      // Two empty generated lines, then one segment at the start of the third: generated column 0
      // maps to source 0, line 41 and column 3, both counted from one in what the collector
      // reports and from zero here.
      mappings: `;;${vlq(0)}${vlq(0)}${vlq(ORIGINAL_LINE - 1)}${vlq(ORIGINAL_COLUMN - 1)}`,
    }),
    'utf8',
  );

  const required = createRequire(import.meta.url)(compiled) as {
    OrdersController: ControllerLike & { prototype: { findAll: HandlerLike } };
  };
  const collector = sourceCollector(absolutePath ? { absolutePath: true } : {});

  try {
    const runtime = collector.collect(
      contextFor(required.OrdersController, 'findAll', required.OrdersController.prototype.findAll),
    );

    return { directory, source: runtime?.source, problems: collector.problems() };
  } finally {
    closeFunctionLocator();
  }
}

describe('a handler in a directory that is not a repository', () => {
  it(
    'should expand the editor template from the source map alone, with no git anywhere',
    () => {
      // Given a compiled handler outside every repository, which is what a container image, an
      // unpushed checkout and a scratch directory all are. The precondition is asserted rather than
      // assumed: nothing above this directory carries a `.git`.
      const found = outsideRepository(true);

      try {
        expect(findRepositoryRoot(found.directory)).toBeUndefined();

        // Then the position is the original file's, through the map, and the repository half is
        // absent because there is no repository to be relative to
        expect(found.source?.file).toBeUndefined();
        expect(found.source?.absolutePath).toBe(join(found.directory, 'orders.controller.ts'));
        expect(found.source?.line).toBe(ORIGINAL_LINE);
        expect(found.source?.column).toBe(ORIGINAL_COLUMN);

        // And the line and the column are read back out of the file the link points at, rather than
        // compared against a number this test remembers
        const text = readFileSync(found.source?.absolutePath ?? '', 'utf8').split('\n')[
          ORIGINAL_LINE - 1
        ];
        expect(text?.slice(ORIGINAL_COLUMN - 1).startsWith('findAll(')).toBe(true);

        // When the editor template is expanded with no revision passed at all
        const link = expandSourceLink(
          'vscode://file/{absolutePath}:{line}:{column}',
          found.source ?? { controller: '', handler: '' },
        );

        // Then
        expect(link.reason).toBeUndefined();
        expect(link.url).toBe(
          `vscode://file${join(found.directory, 'orders.controller.ts')}:${String(ORIGINAL_LINE)}:${String(ORIGINAL_COLUMN)}`,
        );

        // And the forge form still refuses, by name, because `{file}` is the half that is missing
        const forge = expandSourceLink(
          'https://github.com/org/repo/blob/{ref}/{file}#L{line}',
          found.source ?? { controller: '', handler: '' },
          'a1b2c3d',
        );
        expect(forge.url).toBeUndefined();
        expect(found.problems.map((problem) => problem.reason).join(' ')).toContain('no .git');
      } finally {
        rmSync(found.directory, { recursive: true, force: true });
      }
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should say nothing about this machine in the same directory with no opt in',
    () => {
      // Given the default registration and the same files. THE PROOF OF ABSENCE ASSERTS PRESENCE
      // FIRST: the case above shows every one of these fields is available here.
      const found = outsideRepository(false);

      try {
        // Then
        expect(found.source).toEqual({ controller: 'OrdersController', handler: 'findAll' });

        // And the editor template says which option is missing rather than producing nothing
        const link = expandSourceLink(
          'vscode://file/{absolutePath}:{line}:{column}',
          found.source ?? { controller: '', handler: '' },
        );
        expect(link.url).toBeUndefined();
        expect(link.reason).toContain('sourceCollector({ absolutePath: true })');
      } finally {
        rmSync(found.directory, { recursive: true, force: true });
      }
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});
