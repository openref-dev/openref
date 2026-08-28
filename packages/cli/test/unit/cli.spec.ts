import { describe, expect, it } from 'vitest';
import * as index from '../../src/index';
import { PACKAGE_NAME, UPSTREAM_PACKAGES } from '../../src/index';

/**
 * The published surface of the `openref` package, pinned by name.
 *
 * WHY IT IS PINNED, AND IT IS NOT A STYLE RULE. This index grew by about twenty names during T041,
 * every one of them exported so that a test in another package could import it, and nothing anywhere
 * would have said so. A published export is frozen public API: once it ships, removing it is a major
 * version, so a name added for a test's convenience is a support commitment nobody decided to make.
 * A test that needs an internal imports the module by path, which is what every test in this package
 * already does.
 *
 * Only runtime values are listed. A type-only export is erased at runtime and cannot be seen from
 * here, so this pins what the JavaScript surface is; SPEC 17.2 records the whole of it.
 */
const PUBLISHED: readonly string[] = [
  'DEFAULT_CLOSE_TIMEOUT_MS',
  'EXIT_CODE',
  'PACKAGE_NAME',
  'UPSTREAM_PACKAGES',
  'loadDocument',
  'loadFromNestApplication',
  'runCli',
];

describe('openref package shell', () => {
  it('should export exactly the names it publishes, and gain none for a test', () => {
    // When
    const exported = Object.keys(index).sort();

    // Then: a name here that nobody outside this repository asked for is a support commitment
    expect(exported).toEqual([...PUBLISHED].sort());
  });

  it('should expose its own package name', () => {
    // Given
    const expected = 'openref';

    // When
    const actual = PACKAGE_NAME;

    // Then
    expect(actual).toBe(expected);
  });

  it('should declare exactly the upstream packages allowed by the dependency rule', () => {
    // Given
    const allowed = ['@openref/core'];

    // When
    const actual = [...UPSTREAM_PACKAGES];

    // Then
    expect(actual).toEqual(allowed);
  });
});
