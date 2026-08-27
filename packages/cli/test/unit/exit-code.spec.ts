import { describe, expect, it } from 'vitest';
import { EXIT_CODE } from '../../src/cli/domain/exit-code.constants';

describe('EXIT_CODE', () => {
  it('should freeze the three code contract T036 owns from here on', () => {
    // Given
    const expected = { SUCCESS: 0, FINDINGS: 1, USAGE_ERROR: 2 };

    // When
    const actual = { ...EXIT_CODE };

    // Then
    expect(actual).toEqual(expected);
  });
});
