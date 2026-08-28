import { describe, expect, it } from 'vitest';
import { gitObjectArgument, refusedGitArgument } from '../../src/cli/domain/git-ref';

describe('refusedGitArgument', () => {
  it('should refuse an argument that starts with a hyphen, naming what git would do with it', () => {
    // When
    const refusal = refusedGitArgument('--exec=whoami', 'a git ref');

    // Then
    expect(refusal).toContain('git would read as an option');
    expect(refusal).toContain('--exec=whoami');
  });

  it('should refuse an empty argument', () => {
    // When / Then
    expect(refusedGitArgument('', 'a path inside a git ref')).toBe(
      'a path inside a git ref is empty',
    );
  });

  it('should accept a ref that merely contains a hyphen', () => {
    // When / Then
    expect(refusedGitArgument('release-2.0', 'a git ref')).toBeUndefined();
  });

  it('should accept the shell metacharacters that mean nothing to an argument array', () => {
    // Given: these reach git as one argv entry, so none of them is a hazard here. The refusal
    // this module exists for is the option prefix, and over-refusing would break real branch
    // names for a threat that does not apply.
    for (const value of ['feat/$(whoami)', 'a;b', 'a b', 'a&&b', 'a|b']) {
      // When / Then
      expect(refusedGitArgument(value, 'a git ref')).toBeUndefined();
    }
  });
});

describe('gitObjectArgument', () => {
  it('should anchor a relative path to the caller directory, as the file side is', () => {
    // When / Then
    expect(gitObjectArgument('main', 'openapi.json')).toBe('main:./openapi.json');
  });

  it('should leave a path that already says where it starts alone', () => {
    // When / Then
    expect(gitObjectArgument('main', './api/openapi.json')).toBe('main:./api/openapi.json');
    expect(gitObjectArgument('main', '../shared/openapi.json')).toBe('main:../shared/openapi.json');
  });
});
