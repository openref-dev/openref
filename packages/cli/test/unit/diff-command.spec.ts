import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runDiff } from '../../src/cli/api/commands/diff.command';
import { EXIT_CODE } from '../../src/cli/domain/exit-code.constants';
import type { CommandIo } from '../../src/cli/domain/command.types';

const MOCKS = fileURLToPath(new URL('../mocks/', import.meta.url));

function fakeIo(): CommandIo & { readonly out: string[]; readonly err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (line) => out.push(line), stderr: (line) => err.push(line) };
}

describe('runDiff', () => {
  it('should fail with a usage error when either positional is missing', async () => {
    // Given
    const io = fakeIo();
    const spec = resolve(MOCKS, 'mini-spec.json');

    // When
    const outcome = await runDiff({ args: [spec], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(io.err[0]).toContain('two spec paths are required');
  });

  it('should report a usage error naming which side failed to load', async () => {
    // Given
    const io = fakeIo();
    const older = resolve(MOCKS, 'mini-spec.json');
    const missing = resolve(MOCKS, 'does-not-exist.json');

    // When
    const outcome = await runDiff({ args: [older, missing], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(io.err[0]).toContain('does-not-exist.json');
  });

  it('should print the SPEC 17.1 example verbatim on the pair built to produce it, and exit 1', async () => {
    // Given the fixture pair whose changes are exactly the example's six
    const io = fakeIo();
    const older = resolve(MOCKS, 'diff-old.json');
    const newer = resolve(MOCKS, 'diff-new.json');

    // When
    const outcome = await runDiff({ args: [older, newer], ...io });

    // Then, byte for byte the block SPEC 17.1 shows
    expect(io.out.join('')).toBe(
      'BREAKING\n' +
        '  DELETE /users/{id}\n' +
        '  REMOVED response field User.email\n' +
        '  CHANGED User.id  string → number\n' +
        '  ADDED required property CreateUser.country\n' +
        '\n' +
        'NON-BREAKING\n' +
        '  ADDED GET /users/search\n' +
        '  ADDED optional property User.avatar\n',
    );
    expect(outcome.exitCode).toBe(EXIT_CODE.FINDINGS);
  });

  it('should print no changes and exit 0 for a document against itself', async () => {
    // Given
    const io = fakeIo();
    const spec = resolve(MOCKS, 'mini-spec.json');

    // When
    const outcome = await runDiff({ args: [spec, spec], ...io });

    // Then
    expect(io.out.join('')).toBe('No changes.\n');
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
  });

  it('should exit 0 with only the NON-BREAKING section when nothing breaks', async () => {
    // Given the mini pair, whose whole difference is one added operation
    const io = fakeIo();
    const older = resolve(MOCKS, 'mini-spec.json');
    const newer = resolve(MOCKS, 'mini-spec-two.json');

    // When
    const outcome = await runDiff({ args: [older, newer], ...io });

    // Then
    expect(io.out.join('')).toBe('NON-BREAKING\n  ADDED GET /pong\n');
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
  });

  it('should print usage and exit 0 on --help', async () => {
    // Given
    const io = fakeIo();

    // When
    const outcome = await runDiff({ args: ['--help'], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    expect(io.out[0]).toContain('openref diff <old> <new>');
  });
});
