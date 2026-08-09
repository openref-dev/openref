import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '../../src/index';

describe('@openref/theme package shell', () => {
  it('should expose its own package name', () => {
    // Given
    const expected = '@openref/theme';

    // When
    const actual = PACKAGE_NAME;

    // Then
    expect(actual).toBe(expected);
  });
});
