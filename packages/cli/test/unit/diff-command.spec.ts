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

  it('should load both documents and describe each', async () => {
    // Given
    const io = fakeIo();
    const older = resolve(MOCKS, 'mini-spec.json');
    const newer = resolve(MOCKS, 'mini-spec-two.json');

    // When
    const outcome = await runDiff({ args: [older, newer], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    expect(io.out[0]).toContain('1.0.0');
    expect(io.out[1]).toContain('2.0.0');
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
});
