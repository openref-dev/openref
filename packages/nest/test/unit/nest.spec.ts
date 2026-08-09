import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME, UPSTREAM_PACKAGES } from '../../src/index';

describe('@openref/nest package shell', () => {
  it('should expose its own package name', () => {
    // Given
    const expected = '@openref/nest';

    // When
    const actual = PACKAGE_NAME;

    // Then
    expect(actual).toBe(expected);
  });

  it('should declare exactly the upstream packages allowed by the dependency rule', () => {
    // Given
    const allowed = ['@openref/core', '@openref/render', '@openref/runner', '@openref/search'];

    // When
    const actual = [...UPSTREAM_PACKAGES];

    // Then
    expect(actual).toEqual(allowed);
  });
});
