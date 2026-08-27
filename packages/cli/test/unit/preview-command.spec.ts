import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runPreview } from '../../src/cli/api/commands/preview.command';
import { EXIT_CODE } from '../../src/cli/domain/exit-code.constants';
import type { CommandIo } from '../../src/cli/domain/command.types';

const MOCKS = fileURLToPath(new URL('../mocks/', import.meta.url));

function fakeIo(): CommandIo & { readonly out: string[]; readonly err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (line) => out.push(line), stderr: (line) => err.push(line) };
}

describe('runPreview', () => {
  it('should fail with a usage error when --spec is missing', async () => {
    // Given
    const io = fakeIo();

    // When
    const outcome = await runPreview({ args: [], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(io.err[0]).toContain('--spec <path> is required');
  });

  it('should load the document from --spec and succeed', async () => {
    // Given
    const io = fakeIo();
    const spec = resolve(MOCKS, 'mini-spec.json');

    // When
    const outcome = await runPreview({ args: [`--spec=${spec}`], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    expect(io.out.some((line) => line.includes('Mini 1.0.0'))).toBe(true);
  });

  it('should accept --watch without acting on it yet', async () => {
    // Given
    const io = fakeIo();
    const spec = resolve(MOCKS, 'mini-spec.json');

    // When
    const outcome = await runPreview({ args: [`--spec=${spec}`, '--watch'], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
  });
});
