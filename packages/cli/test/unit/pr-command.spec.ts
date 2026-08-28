import { describe, expect, it } from 'vitest';
import { decideComment, previewBaseFor, runPr } from '../../src/cli/api/commands/pr.command';
import type { CommandContext } from '../../src/cli/domain/command.types';
import { EXIT_CODE } from '../../src/cli/domain/exit-code.constants';
import { REFUSED_EVENT_NAME } from '../../src/cli/domain/pr-event';
import { PR_INPUT_ENV } from '../../src/cli/domain/pr-inputs';

interface Captured {
  readonly context: CommandContext;
  readonly out: string[];
  readonly err: string[];
}

function capture(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>> = {},
): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    context: {
      args,
      env,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
    },
  };
}

describe('decideComment', () => {
  it('should not post from a fork, where the token is read only', () => {
    // Given
    const event = {
      number: 1,
      baseRef: 'main',
      baseSha: 'a',
      baseRepository: 'acme/api',
      headRepository: 'contributor/api',
      fromFork: true,
    };

    // When
    const decision = decideComment({ event, token: 'ghs-x', dryRun: false });

    // Then
    expect(decision.post).toBe(false);
    expect(decision.reason).toContain('fork');
  });

  it('should not post with no token, and say that is why', () => {
    // When
    const decision = decideComment({ event: undefined, token: undefined, dryRun: false });

    // Then
    expect(decision.post).toBe(false);
    expect(decision.reason).toContain('GITHUB_TOKEN');
  });

  it('should post when the head is the base repository and a token is set', () => {
    // Given
    const event = {
      number: 1,
      baseRef: 'main',
      baseSha: 'a',
      baseRepository: 'acme/api',
      headRepository: 'acme/api',
      fromFork: false,
    };

    // When / Then
    expect(decideComment({ event, token: 'ghs-x', dryRun: false }).post).toBe(true);
  });

  it('should not post on a dry run whatever else is true', () => {
    // When / Then
    expect(decideComment({ event: undefined, token: 'ghs-x', dryRun: true }).post).toBe(false);
  });
});

describe('previewBaseFor', () => {
  it('should derive one value that is both the build base and the printed address', () => {
    // When / Then
    expect(previewBaseFor('https://docs.example.com/previews', 7)).toBe(
      'https://docs.example.com/previews/pr-7',
    );
  });

  it('should not double a trailing slash', () => {
    // When / Then
    expect(previewBaseFor('https://docs.example.com/previews/', 7)).toBe(
      'https://docs.example.com/previews/pr-7',
    );
  });

  it('should answer nothing when there is no pull request to scope it to', () => {
    // When / Then
    expect(previewBaseFor('https://docs.example.com/previews', undefined)).toBeUndefined();
    expect(previewBaseFor(undefined, 7)).toBeUndefined();
  });
});

describe('openref pr, the arguments it refuses before doing anything', () => {
  it('should refuse --token by name, because a credential on a command line is visible', async () => {
    // Given
    const { context, err } = capture(['--token', 'ghs-secret', '--spec', 'openapi.json']);

    // When
    const outcome = await runPr(context);

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(err.join('')).toContain('--token does not exist');
    expect(err.join('')).toContain('GITHUB_TOKEN');
  });

  it(`should refuse to run on ${REFUSED_EVENT_NAME}, naming what that event hands out`, async () => {
    // Given
    const { context, err } = capture(['--spec', 'openapi.json'], {
      GITHUB_EVENT_NAME: REFUSED_EVENT_NAME,
    });

    // When
    const outcome = await runPr(context);

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(err.join('')).toContain('write scoped token');
  });

  it('should require --spec', async () => {
    // Given
    const { context, err } = capture([]);

    // When
    const outcome = await runPr(context);

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(err.join('')).toContain('--spec <path> is required');
  });

  it('should require a base ref when no event payload names one', async () => {
    // Given
    const { context, err } = capture(['--spec', 'openapi.json']);

    // When
    const outcome = await runPr(context);

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(err.join('')).toContain('no base ref');
  });

  it('should refuse a base ref that git would read as an option', async () => {
    // Given
    const { context, err } = capture(['--spec', 'openapi.json', '--base', '--upload-pack=x']);

    // When
    const outcome = await runPr(context);

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(err.join('')).toContain('git would read as an option');
  });

  it('should refuse a repository that is not exactly owner/name, before any git work', async () => {
    // Given: this used to travel into the API address as written, so `../../escaped` walked a
    // token bearing request out of `/repos/`. It is refused here, ahead of the base ref check,
    // which is why the message below is this one and not the one about a missing base.
    const { context, err } = capture(['--spec', 'openapi.json', '--repository', '../../escaped']);

    // When
    const outcome = await runPr(context);

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(err.join('')).toContain('exactly owner/name');
  });

  it('should refuse the same value arriving as OPENREF_PR_REPOSITORY', async () => {
    // Given: the environment is the path the action uses, so it is guarded identically
    const { context, err } = capture(['--spec', 'openapi.json'], {
      OPENREF_PR_REPOSITORY: '%2e%2e/%2e%2e/x',
    });

    // When
    const outcome = await runPr(context);

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(err.join('')).toContain('exactly owner/name');
  });

  it('should let a legal owner/name through to the next check', async () => {
    // Given: refusing a legal repository would be a different bug of the same size, so the
    // refusals above are shown to be about the value rather than about the option existing
    const { context, err } = capture(['--spec', 'openapi.json', '--repository', 'Acme-Corp/a.b_c']);

    // When
    const outcome = await runPr(context);

    // Then: it got as far as the base ref, which is the check after this one
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(err.join('')).toContain('no base ref');
  });

  it.each([
    ['SP', '\u0020'],
    ['TAB', '\u0009'],
    ['CR', '\u000d'],
    ['LF', '\u000a'],
    ['VT', '\u000b'],
    ['FF', '\u000c'],
    ['NBSP', '\u00a0'],
  ])(
    'should refuse a repository padded with %s the same way on the flag and the variable',
    async (_name, character) => {
      // Given: the flag path always refused these. The environment path trimmed them off first, so
      // the same value was repaired into a legal one and accepted, which is what SPEC 19.11 now
      // forbids on both paths.
      const flag = capture([
        '--spec',
        'openapi.json',
        '--repository',
        `${character}acme/payments${character}`,
      ]);
      const variable = capture(['--spec', 'openapi.json'], {
        OPENREF_PR_REPOSITORY: `${character}acme/payments${character}`,
      });

      // When
      const byFlag = await runPr(flag.context);
      const byVariable = await runPr(variable.context);

      // Then
      expect(byFlag.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
      expect(byVariable.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
      expect(flag.err.join('')).toContain('exactly owner/name');
      expect(variable.err.join('')).toContain('exactly owner/name');
    },
  );

  it('should name the source the bad repository actually came from', async () => {
    // Given: a message that always said --repository sent a reader to edit a flag they never wrote
    const flag = capture(['--spec', 'openapi.json', '--repository', 'acme/../api']);
    const variable = capture(['--spec', 'openapi.json'], {
      OPENREF_PR_REPOSITORY: 'acme/../api',
    });
    const workflow = capture(['--spec', 'openapi.json'], { GITHUB_REPOSITORY: 'acme/../api' });

    // When
    await runPr(flag.context);
    await runPr(variable.context);
    await runPr(workflow.context);

    // Then
    expect(flag.err.join('')).toContain('--repository');
    expect(variable.err.join('')).toContain('OPENREF_PR_REPOSITORY');
    expect(variable.err.join('')).not.toContain('--repository');
    expect(workflow.err.join('')).toContain('GITHUB_REPOSITORY');
    expect(workflow.err.join('')).not.toContain('--repository');
  });

  it('should refuse a boolean input it cannot read', async () => {
    // Given
    const { context, err } = capture(['--spec', 'openapi.json'], {
      OPENREF_PR_FAIL_ON_BREAKING: 'sometimes',
    });

    // When
    const outcome = await runPr(context);

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(err.join('')).toContain('neither true nor false');
  });

  it('should print its usage and succeed on --help', async () => {
    // Given
    const { context, out } = capture(['--help']);

    // When
    const outcome = await runPr(context);

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    expect(out.join('')).toContain('Usage: openref pr');
    expect(out.join('')).toContain('GITHUB_TOKEN');
  });

  it('should name every environment variable it reads, since that is the wiring contract', async () => {
    // Given: the OPENREF_PR_* names are how a consumer wires the action, and they were written
    // down nowhere at all. The list is read from the map the command uses rather than typed here,
    // so a new option cannot be added without the help text gaining its name.
    const { context, out } = capture(['--help']);

    // When
    await runPr(context);
    const help = out.join('');

    // Then
    for (const variable of Object.values(PR_INPUT_ENV)) expect(help).toContain(variable);
    for (const variable of ['GITHUB_EVENT_PATH', 'GITHUB_API_URL', 'GITHUB_OUTPUT']) {
      expect(help).toContain(variable);
    }
    // And the one flag that deliberately has neither a variable nor an action input says so
    expect(help).toContain('--target has no');
  });
});
