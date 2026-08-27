import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DOCTOR_REPORT_VERSION } from '@openref/core';
import { runDoctor } from '../../src/cli/api/commands/doctor.command';
import { EXIT_CODE } from '../../src/cli/domain/exit-code.constants';
import type { CommandIo } from '../../src/cli/domain/command.types';

const FIXTURES = fileURLToPath(new URL('../mocks/from-nest/', import.meta.url));

function fakeIo(): CommandIo & { readonly out: string[]; readonly err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (line) => out.push(line), stderr: (line) => err.push(line) };
}

describe('runDoctor', () => {
  it('should fail with a usage error when --from-nest is missing', async () => {
    // Given
    const io = fakeIo();

    // When
    const outcome = await runDoctor({ args: [], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(io.err[0]).toContain('--from-nest <path> is required');
  });

  it('should reject a --fail-on value SPEC 17 does not list', async () => {
    // Given
    const io = fakeIo();
    const entry = resolve(FIXTURES, 'succeeds.mjs');

    // When
    const outcome = await runDoctor({
      args: [`--from-nest=${entry}`, '--fail-on=catastrophe'],
      ...io,
    });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(io.err[0]).toContain('--fail-on must be one of drift, warn, error');
  });

  it('should accept every SPEC 17 --fail-on value on a document with nothing to find', async () => {
    // Given
    const entry = resolve(FIXTURES, 'succeeds.mjs');

    for (const level of ['drift', 'warn', 'error']) {
      const io = fakeIo();

      // When
      const outcome = await runDoctor({
        args: [`--from-nest=${entry}`, `--fail-on=${level}`],
        ...io,
      });

      // Then
      expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    }
  });

  it('should boot the application and print the document title in the summary', async () => {
    // Given
    const io = fakeIo();
    const entry = resolve(FIXTURES, 'succeeds.mjs');

    // When
    const outcome = await runDoctor({ args: [`--from-nest=${entry}`], ...io });

    // Then
    expect(outcome).toEqual({ exitCode: EXIT_CODE.SUCCESS, forcedShutdown: false });
    expect(io.out.some((line) => line.includes('Fixture 1.0.0'))).toBe(true);
  });

  it('should report the boot error rather than an empty document when the entry fails to boot', async () => {
    // Given
    const io = fakeIo();
    const entry = resolve(FIXTURES, 'boot-throws.mjs');

    // When
    const outcome = await runDoctor({ args: [`--from-nest=${entry}`], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(io.err[0]).toContain('failed to boot');
  });

  it('should never fail when --fail-on is omitted, whatever it finds', async () => {
    // Given a document carrying an error severity finding
    const io = fakeIo();
    const entry = resolve(FIXTURES, 'error-drift.mjs');

    // When
    const outcome = await runDoctor({ args: [`--from-nest=${entry}`], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    expect(io.out.join('')).toContain('DRIFT');
  });

  it('should fail at --fail-on=error on an error severity finding', async () => {
    // Given
    const io = fakeIo();
    const entry = resolve(FIXTURES, 'error-drift.mjs');

    // When
    const outcome = await runDoctor({ args: [`--from-nest=${entry}`, '--fail-on=error'], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.FINDINGS);
  });

  it('should not fail at --fail-on=error on a warning severity finding alone', async () => {
    // Given
    const io = fakeIo();
    const entry = resolve(FIXTURES, 'warning-only.mjs');

    // When
    const outcome = await runDoctor({ args: [`--from-nest=${entry}`, '--fail-on=error'], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
  });

  it('should fail at --fail-on=warn on a warning severity finding', async () => {
    // Given
    const io = fakeIo();
    const entry = resolve(FIXTURES, 'warning-only.mjs');

    // When
    const outcome = await runDoctor({ args: [`--from-nest=${entry}`, '--fail-on=warn'], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.FINDINGS);
  });

  it('should fail at --fail-on=drift on a warning severity finding', async () => {
    // Given
    const io = fakeIo();
    const entry = resolve(FIXTURES, 'warning-only.mjs');

    // When
    const outcome = await runDoctor({ args: [`--from-nest=${entry}`, '--fail-on=drift'], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.FINDINGS);
  });

  it('should print the health summary and a DRIFT block naming the rule code and the fix', async () => {
    // Given
    const io = fakeIo();
    const entry = resolve(FIXTURES, 'error-drift.mjs');

    // When
    await runDoctor({ args: [`--from-nest=${entry}`], ...io });
    const text = io.out.join('');

    // Then
    expect(text).toContain('ErrorDrift 1.0.0');
    expect(text).toContain('Documentation health:');
    expect(text).toContain('DRIFT  RT010  POST /widgets');
    expect(text).toContain('→');
  });

  it('should print only the versioned machine readable report with --json', async () => {
    // Given
    const io = fakeIo();
    const entry = resolve(FIXTURES, 'error-drift.mjs');

    // When
    const outcome = await runDoctor({ args: [`--from-nest=${entry}`, '--json'], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    expect(io.out).toHaveLength(1);
    const report = JSON.parse(io.out[0] ?? '') as {
      version: number;
      findings: readonly { rule: string; code: string; subject: string }[];
    };
    expect(report.version).toBe(DOCTOR_REPORT_VERSION);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      rule: 'security-drift',
      code: 'RT010',
      subject: 'POST /widgets',
    });
  });

  it('should produce byte identical --json output across two runs', async () => {
    // Given
    const entry = resolve(FIXTURES, 'error-drift.mjs');
    const first = fakeIo();
    const second = fakeIo();

    // When
    await runDoctor({ args: [`--from-nest=${entry}`, '--json'], ...first });
    await runDoctor({ args: [`--from-nest=${entry}`, '--json'], ...second });

    // Then
    expect(first.out).toEqual(second.out);
  });
});
