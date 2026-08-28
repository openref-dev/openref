import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { refusesPathSuffix } from '@openref/core/security';
import { SUFFIX_GUARD_LINES } from '../../src/proxy/domain/proxy-files';

/**
 * The guard that four things share, and the property that makes sharing it worth anything.
 *
 * IT EXISTS IN TWO FORMS AND ONLY ONE OF THEM CAN BE CALLED. The three artefacts this package
 * generates are source text for somebody else's runtime, so they carry the guard as lines rather
 * than as a function, while the same origin proxy and the rewriting transport call
 * `refusesPathSuffix` in `@openref/core`. Two forms of one rule is exactly the shape this
 * repository keeps finding drifted, so the first case compiles the lines and holds them to the
 * function over every spelling, rather than comparing two texts to each other.
 */

/** The spellings driven through the generated artefacts when the guard was written, plus ours. */
const REFUSED = [
  '../secret',
  '..%2fsecret',
  '%2e%2e%2fsecret',
  '%2e./secret',
  '.%2e/secret',
  '%252e%252e/secret',
  '..;/secret',
  '..%5csecret',
  '..\\secret',
  'a/../../secret',
  '..%2f..%2fadmin',
  '%zz',
  'a/..',
  '..',
  'a%2f..%2fb',
] as const;

const ADMITTED = [
  '',
  'orders',
  'orders/42',
  'a%20b/c',
  'a.b/c',
  'v1.2/resource',
  '...',
  'a..b',
  'dot.dot',
] as const;

/**
 * Compiles the emitted lines and runs them, the way a generated artefact does.
 *
 * Through `node:vm` rather than through the `Function` constructor, which is the shape
 * `@openref/static` already uses to execute the bytes it generates, and which keeps the lint rule
 * against implied evaluation meaningful everywhere else.
 */
function compiledGuard(): (rest: string) => boolean {
  const body = ['(function (rest) {', ...SUFFIX_GUARD_LINES, '  return refusedRest;', '})'].join(
    '\n',
  );
  return runInNewContext(body) as (rest: string) => boolean;
}

describe('the shared path suffix guard', () => {
  it('should give the same answer as the lines the generated artefacts run', () => {
    // Given the guard as a function and the same guard as the source text it is emitted as
    const emitted = compiledGuard();

    // When both are asked about every spelling
    // Then they never disagree, which is what one home in two forms has to mean
    for (const rest of [...REFUSED, ...ADMITTED]) {
      expect([rest, emitted(rest)]).toEqual([rest, refusesPathSuffix(rest)]);
    }
  });

  it.each(REFUSED)('should refuse the suffix %s', (rest) => {
    // Given a suffix that climbs above the pinned base in some spelling
    // When it is checked
    // Then it is refused rather than repaired
    expect(refusesPathSuffix(rest)).toBe(true);
  });

  it.each(ADMITTED)('should admit the ordinary suffix %s', (rest) => {
    // Given a suffix a reader would really send
    // When it is checked
    // Then it passes, because a guard that refuses everything is not a guard
    expect(refusesPathSuffix(rest)).toBe(false);
  });
});
