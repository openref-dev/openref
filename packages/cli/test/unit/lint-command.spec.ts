import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runLint } from '../../src/cli/api/commands/lint.command';
import { EXIT_CODE } from '../../src/cli/domain/exit-code.constants';
import type { CommandIo } from '../../src/cli/domain/command.types';

const MOCKS = fileURLToPath(new URL('../mocks/', import.meta.url));

function fakeIo(): CommandIo & { readonly out: string[]; readonly err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (line) => out.push(line), stderr: (line) => err.push(line) };
}

describe('runLint', () => {
  it('should fail with a usage error when the spec positional is missing', async () => {
    // Given
    const io = fakeIo();

    // When
    const outcome = await runLint({ args: [], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(io.err[0]).toContain('a spec path is required');
  });

  it('should produce no output and exit 0 for a specification with no quality issues', async () => {
    // Given
    const io = fakeIo();
    const spec = resolve(MOCKS, 'clean-spec.json');

    // When
    const outcome = await runLint({ args: [spec], ...io });

    // Then. Silence is the correct result, per SPEC 17 and the T037 amendment.
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    expect(io.out).toEqual([]);
    expect(io.err).toEqual([]);
  });

  it('should report a quality finding and exit 1 for a specification missing a description', async () => {
    // Given, /ping carries neither a summary nor a description
    const io = fakeIo();
    const spec = resolve(MOCKS, 'mini-spec.json');

    // When
    const outcome = await runLint({ args: [spec], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.FINDINGS);
    const text = io.out.join('');
    expect(text).toContain('DRIFT  DX010  GET /ping');
    expect(text).toContain('→');
  });

  it('should print no health summary or title, only findings', async () => {
    // Given
    const io = fakeIo();
    const spec = resolve(MOCKS, 'mini-spec.json');

    // When
    await runLint({ args: [spec], ...io });
    const text = io.out.join('');

    // Then
    expect(text).not.toContain('Documentation health');
    expect(text).not.toContain('Mini 1.0.0');
  });
});
