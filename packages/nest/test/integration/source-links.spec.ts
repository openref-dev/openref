import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expandSourceLink, type IRSourceLocation } from '@openref/core';

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
 * Boots the example and reads its report.
 *
 * @returns What the application said about its own sources
 */
function report(): Report {
  if (!existsSync(join(example, 'dist', 'main.js'))) {
    throw new Error('examples/nest-minimal is not built. Run pnpm build; a skip is not a pass');
  }

  const printed = execFileSync(process.execPath, ['--input-type=module', '-e', PROGRAM], {
    cwd: example,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return JSON.parse(printed) as Report;
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
  it('should give every operation a source with a repository relative file and a line', () => {
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
  });

  it('should put each line on the method it names, read back out of the file', () => {
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
  });

  it('should expand every source into a link with the revision this build was made from', () => {
    // Given
    const found = report();

    // Then the template has had `{ref}` filled in from git, so what is left is per node
    expect(found.template).toBeDefined();
    expect(found.template).not.toContain('{ref}');
    expect(found.template).toMatch(/^https:\/\/github\.com\/[^/]+\/openref\/blob\/[0-9a-f]{40}\//);

    for (const source of found.sources) {
      const link = expandSourceLink(found.template ?? '', source);

      expect(link.reason).toBeUndefined();
      expect(link.withoutLine).toBeUndefined();
      expect(link.url).toContain('/examples/nest-minimal/src/orders.controller.ts#L');
      expect(link.url).not.toContain('NaN');
      expect(link.url).not.toContain('{');
    }
  });
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

describe('the NestJS 10 CommonJS arm, which is built with no source maps', () => {
  it('should locate a handler on CommonJS, where V8 names a script by path not by url', () => {
    // Given the other arm of the SPEC 23 matrix. The example is ESM and its scripts arrive as
    // `file:` urls; a CommonJS module arrives as a plain absolute path, which is a branch of the
    // locator that nothing else in the suite reaches.
    if (!existsSync(join(compat, 'dist', 'serve.js'))) {
      throw new Error('compat/nest10-cjs is not built. Run pnpm build; a skip is not a pass');
    }

    // When
    const printed = execFileSync(process.execPath, ['--input-type=commonjs', '-e', CJS_PROGRAM], {
      cwd: compat,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const found = JSON.parse(printed) as Report;

    // Then the class and the method are named, and the file is the compiled one, because that is
    // where the code is when nothing said otherwise
    expect(found.operations).toBeGreaterThan(0);
    expect(found.sources).toHaveLength(found.operations);

    for (const source of found.sources) {
      expect(source.controller).toBe('OrdersController');
      expect(source.file).toBe('compat/nest10-cjs/dist/serve.js');
      expect(source.file?.startsWith('/')).toBe(false);
    }
  });

  it('should point the line at the emitted file, since with no map the script is the source', () => {
    // Given the same boot. WITHOUT A SOURCE MAP THERE IS NOTHING TO TRANSLATE AND NOTHING IS
    // GUESSED: the file this arm reports is the JavaScript, so the line it reports is a line of
    // that JavaScript, and the two agree. The dishonest answer would be a TypeScript line number
    // taken from a JavaScript file, and the empty answer would be a file link where a precise one
    // was available. This asserts the pair by reading the line the link points at.
    const printed = execFileSync(process.execPath, ['--input-type=commonjs', '-e', CJS_PROGRAM], {
      cwd: compat,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const found = JSON.parse(printed) as Report;

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
  });
});
