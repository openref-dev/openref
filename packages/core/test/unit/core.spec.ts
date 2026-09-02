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
    // Given, 3 since 2026-09-01: canonical serialization stopped sorting the keys of a map whose
    // order the document wrote, per SPEC 5.3, so the same document carries a different hash than
    // it did under 2 while nothing about its shape moved
    const expected = 3;

    // When
    const actual = IR_VERSION;

    // Then
    expect(actual).toBe(expected);
  });
});
