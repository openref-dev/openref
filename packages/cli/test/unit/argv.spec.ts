import { describe, expect, it } from 'vitest';
import { parseArgs, stringFlag } from '../../src/cli/api/argv';

describe('parseArgs', () => {
  it('should read a --key=value flag', () => {
    // Given
    const args = ['--spec=./openapi.yaml'];

    // When
    const { flags } = parseArgs(args, ['spec']);

    // Then
    expect(flags.get('spec')).toBe('./openapi.yaml');
  });

  it('should read a --key value flag when the key is declared as taking a value', () => {
    // Given
    const args = ['--spec', './openapi.yaml'];

    // When
    const { flags } = parseArgs(args, ['spec']);

    // Then
    expect(flags.get('spec')).toBe('./openapi.yaml');
  });

  it('should read an undeclared flag as a boolean rather than consuming the next argument', () => {
    // Given
    const args = ['--watch', 'build.yaml'];

    // When
    const { flags, positionals } = parseArgs(args, ['spec']);

    // Then
    expect(flags.get('watch')).toBe(true);
    expect(positionals).toEqual(['build.yaml']);
  });

  it('should read -h as the boolean help flag', () => {
    // Given
    const args = ['-h'];

    // When
    const { flags } = parseArgs(args);

    // Then
    expect(flags.get('help')).toBe(true);
  });

  it('should collect positionals apart from flags, in order', () => {
    // Given
    const args = ['old.json', '--spec=x', 'new.json'];

    // When
    const { positionals } = parseArgs(args, ['spec']);

    // Then
    expect(positionals).toEqual(['old.json', 'new.json']);
  });

  it('should not consume a value for a value flag given last with nothing after it', () => {
    // Given
    const args = ['--spec'];

    // When
    const { flags } = parseArgs(args, ['spec']);

    // Then
    expect(flags.get('spec')).toBe(true);
  });
});

describe('stringFlag', () => {
  it('should return the value when the flag was given a string', () => {
    // Given
    const { flags } = parseArgs(['--spec=x'], ['spec']);

    // When
    const value = stringFlag(flags, 'spec');

    // Then
    expect(value).toBe('x');
  });

  it('should return undefined when the flag was given as a bare boolean', () => {
    // Given
    const { flags } = parseArgs(['--watch']);

    // When
    const value = stringFlag(flags, 'watch');

    // Then
    expect(value).toBeUndefined();
  });

  it('should return undefined when the flag was never given', () => {
    // Given
    const { flags } = parseArgs([]);

    // When
    const value = stringFlag(flags, 'spec');

    // Then
    expect(value).toBeUndefined();
  });
});
