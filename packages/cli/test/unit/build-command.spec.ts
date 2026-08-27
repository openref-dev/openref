import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runBuild } from '../../src/cli/api/commands/build.command';
import { EXIT_CODE } from '../../src/cli/domain/exit-code.constants';
import type { CommandIo } from '../../src/cli/domain/command.types';

const MOCKS = fileURLToPath(new URL('../mocks/', import.meta.url));

function fakeIo(): CommandIo & { readonly out: string[]; readonly err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (line) => out.push(line), stderr: (line) => err.push(line) };
}

describe('runBuild', () => {
  it('should fail with a usage error when no source is given', async () => {
    // Given
    const io = fakeIo();

    // When
    const outcome = await runBuild({ args: [], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(io.err[0]).toContain('one of --spec, --config or --from-nest is required');
  });

  it('should fail with a usage error when more than one source is given', async () => {
    // Given
    const io = fakeIo();

    // When
    const outcome = await runBuild({
      args: ['--spec=a.json', '--from-nest=b.js'],
      ...io,
    });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(io.err[0]).toContain('only one of');
  });

  it('should load the document from --spec and succeed', async () => {
    // Given
    const io = fakeIo();
    const spec = resolve(MOCKS, 'mini-spec.json');

    // When
    const outcome = await runBuild({ args: [`--spec=${spec}`], ...io });

    // Then
    expect(outcome).toEqual({ exitCode: EXIT_CODE.SUCCESS, forcedShutdown: false });
    expect(io.out.some((line) => line.includes('Mini 1.0.0'))).toBe(true);
  });

  it('should accept --out, --base and --target without acting on them yet', async () => {
    // Given
    const io = fakeIo();
    const spec = resolve(MOCKS, 'mini-spec.json');

    // When
    const outcome = await runBuild({
      args: [`--spec=${spec}`, '--out=dist', '--base=/docs', '--target=netlify'],
      ...io,
    });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
  });
});
