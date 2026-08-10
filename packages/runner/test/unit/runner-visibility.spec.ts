import { describe, expect, expectTypeOf, it } from 'vitest';
import { createRunner, type PrefilledCredentials, type RunnerOptions } from '../../src/index';

/**
 * The type level half of SPEC 14.4: under `visibility: 'public'`, prefilling is forbidden.
 *
 * A COMPILE ERROR IS THE POINT, so the assertions are `@ts-expect-error` rather than a runtime
 * check of a value. `@ts-expect-error` fails the build when the line it guards STOPS being an
 * error, which is the direction that matters: the day the conditional member is loosened, this
 * file stops compiling and `pnpm lint` says so. A runtime assertion would keep passing while
 * the type gate quietly disappeared.
 *
 * The root tsconfig typechecks the test tree, so this runs in `pnpm lint` and not only here.
 */
describe('the public visibility prefill restriction', () => {
  it('should refuse a prefilled credential under public visibility, at compile time', () => {
    // Given, each of these is a call a deployment on the open internet could otherwise make.
    const attempts = (): void => {
      // @ts-expect-error prefilling credentials is forbidden when visibility is public
      createRunner({ visibility: 'public', credentials: { bearerAuth: 'secret' } });

      // @ts-expect-error the ban holds for an empty credential map as well as a filled one
      createRunner({ visibility: 'public', credentials: {} });

      const options: RunnerOptions<'public'> = {
        visibility: 'public',
        // @ts-expect-error the ban is on the option type, not only on the factory
        credentials: { bearerAuth: 'secret' },
      };
      void options;
    };

    // When
    void attempts;

    // Then, the assertion is that this file compiles, which `pnpm lint` proves.
    expectTypeOf<RunnerOptions<'public'>>().toHaveProperty('credentials');
    expectTypeOf<NonNullable<RunnerOptions<'public'>['credentials']>>().toEqualTypeOf<never>();
  });

  it('should allow a prefilled credential under internal visibility', () => {
    // Given
    const credentials: PrefilledCredentials = { bearerAuth: 'secret' };

    // When
    const runner = createRunner({ visibility: 'internal', storage: 'memory', credentials });

    // Then
    expect(runner.credential('bearerAuth')).toBe('secret');
  });

  it('should drop a prefilled credential under public visibility for a caller with no types', () => {
    // Given, the type gate is the contract; this is the same rule once more for JavaScript.
    const options = { visibility: 'public', storage: 'memory', credentials: { k: 'secret' } };

    // When
    const runner = createRunner(options as RunnerOptions<'internal'>);

    // Then
    expect(runner.credential('k')).toBeUndefined();
  });
});
