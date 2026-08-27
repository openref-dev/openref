import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../../src/cli/application/services/run-cli.service';
import { EXIT_CODE } from '../../src/cli/domain/exit-code.constants';
import type { CommandIo } from '../../src/cli/domain/command.types';

const MOCKS = fileURLToPath(new URL('../mocks/', import.meta.url));

function fakeIo(): CommandIo & { readonly out: string[]; readonly err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  };
}

describe('runCli', () => {
  it('should print the top level usage and exit with a usage error when no command is given', async () => {
    // Given
    const io = fakeIo();

    // When
    const outcome = await runCli([], io);

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(io.err.some((line) => line.includes('openref build'))).toBe(true);
  });

  it('should print the top level usage and succeed on --help', async () => {
    // Given
    const io = fakeIo();

    // When
    const outcome = await runCli(['--help'], io);

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    expect(io.out.some((line) => line.includes('openref diff'))).toBe(true);
  });

  it('should print the top level usage and succeed on -h', async () => {
    // Given
    const io = fakeIo();

    // When
    const outcome = await runCli(['-h'], io);

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
  });

  it('should report an unknown command as a usage error', async () => {
    // Given
    const io = fakeIo();

    // When
    const outcome = await runCli(['frobnicate'], io);

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(io.err[0]).toContain('frobnicate');
  });

  it('should dispatch a known command with its own arguments', async () => {
    // Given, a spec whose one operation has neither a summary nor a description
    const io = fakeIo();
    const spec = resolve(MOCKS, 'mini-spec.json');

    // When
    const outcome = await runCli(['lint', spec], io);

    // Then, proof the positional argument reached the exact file this command loaded rather
    // than some other dispatch going right by coincidence
    expect(outcome.exitCode).toBe(EXIT_CODE.FINDINGS);
    expect(io.out.some((line) => line.includes('GET /ping'))).toBe(true);
  });

  it('should default to the real process streams when none are given', async () => {
    // Given
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    // When
    const outcome = await runCli(['--help']);

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    expect(write).toHaveBeenCalled();
    write.mockRestore();
  });
});
