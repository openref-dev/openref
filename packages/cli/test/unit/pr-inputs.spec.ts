import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../src/cli/api/argv';
import {
  PR_BOOLEAN_FLAGS,
  PR_INPUT_ENV,
  PR_OUTPUT_NAMES,
  PR_VALUE_FLAGS,
  readBoolean,
  resolvePrInputs,
} from '../../src/cli/domain/pr-inputs';
import { readPullRequestEvent } from '../../src/cli/domain/pr-event';

describe('readBoolean', () => {
  it('should read the string a workflow writes when it means off', () => {
    // Given: every GitHub action input is a string, so "false" is what off looks like
    // When / Then
    for (const value of ['false', 'FALSE', '0', 'no', '', '  ']) {
      expect(readBoolean(value)).toBe(false);
    }
  });

  it('should read the string a workflow writes when it means on', () => {
    // When / Then
    for (const value of ['true', 'TRUE', '1', 'yes']) {
      expect(readBoolean(value)).toBe(true);
    }
  });

  it('should report a value it cannot read rather than pick a side', () => {
    // When
    const read = readBoolean('maybe');

    // Then
    expect(read).toEqual({ unreadable: '"maybe" is neither true nor false' });
  });

  it('should read nothing at all as off', () => {
    // When / Then
    expect(readBoolean(undefined)).toBe(false);
  });
});

describe('resolvePrInputs', () => {
  it('should read every option from the environment when no flag gives it', () => {
    // Given the environment the action's env block produces
    const env = {
      OPENREF_PR_SPEC: 'openapi.json',
      OPENREF_PR_BASE: 'origin/main',
      OPENREF_PR_OUT: 'dist-docs',
      OPENREF_PR_PREVIEW_BASE: 'https://docs.example.com/previews',
      OPENREF_PR_PREVIEW_URL: '',
      OPENREF_PR_FAIL_ON_BREAKING: 'true',
      OPENREF_PR_DRY_RUN: 'false',
      OPENREF_PR_REPOSITORY: 'acme/api',
      OPENREF_PR_NUMBER: '7',
    };

    // When
    const inputs = resolvePrInputs(parseArgs([]).flags, env);

    // Then
    expect(inputs).toEqual({
      spec: 'openapi.json',
      base: 'origin/main',
      out: 'dist-docs',
      previewBase: 'https://docs.example.com/previews',
      previewUrl: undefined,
      failOnBreaking: true,
      dryRun: false,
      repository: 'acme/api',
      repositorySource: 'OPENREF_PR_REPOSITORY',
      pullRequest: '7',
    });
  });

  it('should let a flag beat the environment, so a person can run the same command by hand', () => {
    // Given
    const env = { OPENREF_PR_SPEC: 'from-env.json' };

    // When
    const inputs = resolvePrInputs(
      parseArgs(['--spec', 'from-flag.json'], PR_VALUE_FLAGS).flags,
      env,
    );

    // Then
    expect(inputs).toMatchObject({ spec: 'from-flag.json' });
  });

  it('should treat an empty environment value as nothing set', () => {
    // Given: every unset action input arrives as the empty string, not as an absent variable
    const env = { OPENREF_PR_OUT: '', OPENREF_PR_PREVIEW_BASE: '   ' };

    // When
    const inputs = resolvePrInputs(parseArgs([]).flags, env);

    // Then
    expect(inputs).toMatchObject({ out: undefined, previewBase: undefined });
  });

  it('should refuse a boolean it cannot read rather than default it to off', () => {
    // When
    const inputs = resolvePrInputs(parseArgs([]).flags, { OPENREF_PR_DRY_RUN: 'sometimes' });

    // Then
    expect(inputs).toEqual({ usageError: '--dry-run "sometimes" is neither true nor false' });
  });

  it('should accept a bare boolean flag', () => {
    // When
    const inputs = resolvePrInputs(parseArgs(['--fail-on-breaking'], PR_VALUE_FLAGS).flags, {});

    // Then
    expect(inputs).toMatchObject({ failOnBreaking: true });
  });

  it('should hand the repository over exactly as supplied, whitespace and all', () => {
    // Given: this value becomes part of a URL a write scoped token is sent to, and the parser it
    // reaches says in so many words that it refuses rather than repairs. Trimming here made that
    // false for the environment path alone: measured before this change, a leading tab on
    // OPENREF_PR_REPOSITORY was repaired into a legal value and accepted, while the same string
    // as --repository was refused.
    // When
    const tabbed = resolvePrInputs(parseArgs([]).flags, {
      OPENREF_PR_REPOSITORY: '\u0009acme/api\u000a',
    });

    // Then
    expect(tabbed).toMatchObject({ repository: '\u0009acme/api\u000a' });
  });

  it('should still read an empty repository as an option nobody set', () => {
    // Given: every unset action input arrives as the empty string, so emptiness is absence
    // When
    const inputs = resolvePrInputs(parseArgs([]).flags, { OPENREF_PR_REPOSITORY: '' });

    // Then
    expect(inputs).toMatchObject({ repository: undefined, repositorySource: undefined });
  });

  it('should keep trimming the options whose values are re-checked further down', () => {
    // Given: a path, a ref, an address and a number are each validated by whatever executes them,
    // and an action input routinely arrives with a trailing newline from a YAML block scalar
    // When
    const inputs = resolvePrInputs(parseArgs([]).flags, {
      OPENREF_PR_SPEC: ' openapi.json\n',
      OPENREF_PR_BASE: '\tmain ',
      OPENREF_PR_NUMBER: ' 7\n',
    });

    // Then
    expect(inputs).toMatchObject({ spec: 'openapi.json', base: 'main', pullRequest: '7' });
  });

  it('should say where the repository came from, so a refusal can name it', () => {
    // When
    const fromFlag = resolvePrInputs(parseArgs(['--repository', 'a/b'], PR_VALUE_FLAGS).flags, {
      OPENREF_PR_REPOSITORY: 'c/d',
    });
    const fromEnv = resolvePrInputs(parseArgs([]).flags, { OPENREF_PR_REPOSITORY: 'c/d' });

    // Then: the flag beats the environment, and the source follows the value rather than a guess
    expect(fromFlag).toMatchObject({ repository: 'a/b', repositorySource: '--repository' });
    expect(fromEnv).toMatchObject({ repository: 'c/d', repositorySource: 'OPENREF_PR_REPOSITORY' });
  });
});

describe('the contract the action wires to', () => {
  it('should give every option and every boolean an environment variable', () => {
    // Given
    const named = [...PR_VALUE_FLAGS, ...PR_BOOLEAN_FLAGS];

    // When
    const missing = named.filter((name) => PR_INPUT_ENV[name] === undefined);

    // Then
    expect(missing).toEqual([]);
  });

  it('should name no environment variable that no option answers to', () => {
    // Given
    const named = new Set([...PR_VALUE_FLAGS, ...PR_BOOLEAN_FLAGS]);

    // When
    const orphans = Object.keys(PR_INPUT_ENV).filter((name) => !named.has(name));

    // Then: an entry no option reads would be a variable the action sets and nothing consumes
    expect(orphans).toEqual([]);
  });

  it('should keep every variable in one prefix, so a reader can find them all', () => {
    // When / Then
    expect(Object.values(PR_INPUT_ENV).every((name) => name.startsWith('OPENREF_PR_'))).toBe(true);
  });

  it('should declare the four outputs a workflow can read', () => {
    // When / Then
    expect([...PR_OUTPUT_NAMES].sort()).toEqual([
      'breaking-count',
      'change-count',
      'comment-url',
      'preview-url',
    ]);
  });
});

describe('readPullRequestEvent', () => {
  it('should read the number, the base and the two repositories', () => {
    // Given
    const payload = JSON.stringify({
      pull_request: {
        number: 42,
        base: { ref: 'main', sha: 'abc123', repo: { full_name: 'acme/api' } },
        head: { ref: 'topic', sha: 'def456', repo: { full_name: 'acme/api' } },
      },
    });

    // When
    const event = readPullRequestEvent(payload);

    // Then
    expect(event).toEqual({
      number: 42,
      baseRef: 'main',
      baseSha: 'abc123',
      baseRepository: 'acme/api',
      headRepository: 'acme/api',
      fromFork: false,
    });
  });

  it('should call a head in another repository a fork', () => {
    // Given
    const payload = JSON.stringify({
      pull_request: {
        number: 3,
        base: { ref: 'main', sha: 'a', repo: { full_name: 'acme/api' } },
        head: { repo: { full_name: 'contributor/api' } },
      },
    });

    // When / Then
    expect(readPullRequestEvent(payload)?.fromFork).toBe(true);
  });

  it('should call a deleted head repository a fork rather than assume it is our own', () => {
    // Given: GitHub writes null here when the fork is gone
    const payload = JSON.stringify({
      pull_request: {
        number: 3,
        base: { ref: 'main', sha: 'a', repo: { full_name: 'acme/api' } },
        head: { repo: null },
      },
    });

    // When / Then
    expect(readPullRequestEvent(payload)?.fromFork).toBe(true);
  });

  it('should never read the global id as the pull request number', () => {
    // Given a payload with an id and no number, which addresses nothing under /issues/
    const payload = JSON.stringify({
      pull_request: { id: 998877, base: { ref: 'main' } },
    });

    // When / Then
    expect(readPullRequestEvent(payload)?.number).toBeUndefined();
  });

  it('should answer nothing for a payload that is not a pull request event', () => {
    // When / Then
    expect(readPullRequestEvent(JSON.stringify({ push: {} }))).toBeUndefined();
    expect(readPullRequestEvent('not json at all')).toBeUndefined();
  });
});
