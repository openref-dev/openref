import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeFunctionLocator,
  locateFunction,
} from '../../src/runtime/infrastructure/adapters/function-location.adapter';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * The locator, checked against a file whose line numbers this test can count.
 *
 * IT ASKS FOR A LINE IT WROTE. Asserting a hardcoded number against a source file is a test that
 * fails whenever somebody adds an import, which trains a reader to update the number without
 * reading it. The class below is followed by a lookup of where this very file says it is, so the
 * expected line is derived from the same text V8 read.
 *
 * THE SECOND HALF IS THE COMPILED CASE AND IT COMPILES SOMETHING. Under Vitest a handler is
 * defined in a `.ts` file that Vite transformed, with an inline source map, which already proves
 * the map is read. What that cannot prove is the shape T018 actually ships into: `tsc` output in
 * a `dist/` directory, with a `.js.map` beside it. So the last case builds one and loads it.
 */

/*
 * `unbound-method` IS DISABLED FOR THIS FILE AND FOR NO OTHER, and the reason is the subject.
 * The rule guards against a method being separated from its object and then CALLED with the wrong
 * `this`, which is a real defect and stays on everywhere else. Every expression it flags here is a
 * method being separated from its object and never called: it is handed to `locateFunction`, which
 * asks V8 where the function was written and returns a file and a line. Annotating each fixture
 * with `this: void` would satisfy the rule and misdescribe it, since a real NestJS handler does use
 * `this`, and that is exactly the shape the locator has to work on.
 */
/* eslint-disable @typescript-eslint/unbound-method */

/**
 * Line of the `list` method below, read out of this file rather than counted.
 *
 * A hardcoded number here would be wrong the first time somebody adds an import above, and the
 * fix would be to update the number without reading it. This is the same text V8 read, so the two
 * disagree only if the locator is wrong.
 */
const LIST_LINE =
  readFileSync(import.meta.filename, 'utf8')
    .split('\n')
    .findIndex((line) => line === '  list(): number {') + 1;

class OrdersController {
  list(): number {
    return 1;
  }

  read(): number {
    return 2;
  }
}

/** A handler that is not a function V8 has a location for. */
const bound = OrdersController.prototype.list.bind(new OrdersController());

let built: string | undefined;

afterEach(() => {
  closeFunctionLocator();
  if (built !== undefined) rmSync(built, { recursive: true, force: true });
  built = undefined;
});

describe('locateFunction', () => {
  it('should find the file and the line a method is written on', () => {
    // Given a method whose line is known, since it is in this file
    // When
    const result = locateFunction(OrdersController.prototype.list);

    // Then
    expect(result.reason).toBeUndefined();
    expect(result.location?.file).toBe(import.meta.filename);
    expect(result.location?.line).toBe(LIST_LINE);
  });

  it('should tell two methods of one class apart', () => {
    // Given. A locator returning the class's line for every method would pass the case above and
    // be useless, which is what this rules out.
    // When
    const list = locateFunction(OrdersController.prototype.list);
    const read = locateFunction(OrdersController.prototype.read);

    // Then
    expect(read.location?.line).toBe(LIST_LINE + 4);
    expect(read.location?.line).not.toBe(list.location?.line);
  });

  it(
    'should read the line back through a source map beside a compiled file',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given a real `tsc` build, which is what a deployed NestJS application is. The line in the
      // emitted JavaScript is not the line in the TypeScript, so an answer that matches the source
      // is an answer that went through the map.
      // `realpathSync` because macOS puts the temporary directory behind a symlink, and the map
      // records the path the compiler resolved rather than the one it was handed.
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'openref-sourcemap-')));
      built = root;
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(
        join(root, 'src', 'demo.ts'),
        [
          '/** A comment, so that the emitted line and the source line differ. */',
          'export class Demo {',
          '  alpha(): number {',
          '    return 1;',
          '  }',
          '',
          '  beta(): number {',
          '    return 2;',
          '  }',
          '}',
          '',
        ].join('\n'),
        'utf8',
      );
      writeFileSync(
        join(root, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            outDir: 'dist',
            rootDir: 'src',
            sourceMap: true,
          },
        }),
        'utf8',
      );
      writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
      execFileSync(
        join(import.meta.dirname, '..', '..', '..', '..', 'node_modules', '.bin', 'tsc'),
        ['-p', join(root, 'tsconfig.json')],
      );

      // When
      return import(join(root, 'dist', 'demo.js')).then((module) => {
        const demo = (module as { Demo: { prototype: { alpha(): number; beta(): number } } }).Demo;
        const alpha = locateFunction(demo.prototype.alpha);
        const beta = locateFunction(demo.prototype.beta);

        // Then the TypeScript line and the TypeScript file, not the emitted ones
        expect(alpha.location?.file).toBe(join(root, 'src', 'demo.ts'));
        expect(alpha.location?.file.endsWith('.ts')).toBe(true);
        expect(alpha.location?.line).toBe(3);
        expect(beta.location?.line).toBe(7);
      });
    },
  );

  it('should refuse a bound function rather than pointing at the binding', () => {
    // Given. V8 has no `[[FunctionLocation]]` for a bound function, and the honest answer is that
    // there is none rather than the location of whatever produced it.
    // When
    const result = locateFunction(bound);

    // Then
    expect(result.location).toBeUndefined();
    expect(result.reason).toContain('[[FunctionLocation]]');
  });

  it('should refuse a native function, which is written in no file at all', () => {
    // Given
    // When
    const result = locateFunction(Math.max);

    // Then
    expect(result.location).toBeUndefined();
    expect(result.reason).not.toBeUndefined();
  });

  it('should never return both a location and no reason to look further', () => {
    // Given the invariant the collector switches on: a result either locates something or says
    // why it could not, and the file only case does both.
    const results = [
      locateFunction(OrdersController.prototype.list),
      locateFunction(bound),
      locateFunction(Math.max),
    ];

    // When, Then
    for (const result of results) {
      expect(result.location !== undefined || result.reason !== undefined).toBe(true);
    }
  });

  it('should leave no session attached once the pass has finished', () => {
    // Given a lookup, which opens one. `Debugger.enable` makes V8 keep debug information it would
    // otherwise drop, so a session left attached is a cost this package imposed on a consumer's
    // production process and never mentioned.
    locateFunction(OrdersController.prototype.list);

    // When the synchronous run ends, which is what the microtask waits for
    return Promise.resolve().then(() => {
      // Then a second lookup still works, having reattached
      const again = locateFunction(OrdersController.prototype.read);
      expect(again.location?.line).toBe(LIST_LINE + 4);
    });
  });
});
