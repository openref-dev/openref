import { describe, expect, it } from 'vitest';
import { IR_VERSION, PACKAGE_NAME } from '../../src/index';

describe('@openref/core package shell', () => {
  it('should expose its own package name', () => {
    // Given
    const expected = '@openref/core';

    // When
    const actual = PACKAGE_NAME;

    // Then
    expect(actual).toBe(expected);
  });

  it('should pin the intermediate representation version', () => {
    // Given, 2 since TX-SHAPES: the conditional keywords entered the IR, so a document that
    // writes them hashes differently than it did under 1
    const expected = 2;

    // When
    const actual = IR_VERSION;

    // Then
    expect(actual).toBe(expected);
  });
});
