import { describe, expect, it, vi } from 'vitest';
import { CoverageTimeoutNote } from '../../../../vitest.timeout-note.ts';
import type { TestCase, Vitest } from 'vitest/node';

/**
 * The note that makes a coverage run timeout legible, per finding F25.
 *
 * WHAT IT HAS TO GET RIGHT IS WHEN IT STAYS QUIET. A paragraph printed under every failure is
 * noise, and noise beside a real defect is worse than nothing: it is an explanation offered for
 * something it does not explain. So the two negative cases below carry the same weight as the
 * positive one, and the reporter is driven directly rather than through a run, because what is
 * under test is the decision and not vitest.
 */

/** A reporter with its output captured. */
function noteWith(coverage: boolean): {
  note: CoverageTimeoutNote;
  written: () => string;
} {
  const chunks: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
    return true;
  });

  const note = new CoverageTimeoutNote();
  note.onInit({ config: { coverage: { enabled: coverage } } } as unknown as Vitest);

  return { note, written: () => chunks.join('') };
}

/** A finished case, reduced to the three members the reporter reads. */
function testCase(name: string, message: string | undefined): TestCase {
  return {
    fullName: name,
    module: { moduleId: `/repo/${name}.spec.ts` },
    result: () => ({
      state: message === undefined ? 'passed' : 'failed',
      errors: message === undefined ? [] : [{ message }],
    }),
  } as unknown as TestCase;
}

describe('the coverage timeout note', () => {
  it('should name the coverage run when a case timed out in one', () => {
    // Given
    const { note, written } = noteWith(true);

    // When
    note.onTestCaseResult(testCase('slow', 'Test timed out in 5000ms.'));
    note.onTestRunEnd();

    // Then it says which run this is, that instrumentation is what is different about it, and
    // how to tell the interaction from a real failure.
    const text = written();
    expect(text).toContain('this is the coverage run');
    expect(text).toContain('instrumentation');
    expect(text).toContain('F25');
    expect(text).toContain('pnpm test');
    expect(text).toContain('slow');
  });

  it('should say nothing when the same timeout happens without coverage', () => {
    // Given, an ordinary run: the failure is legible on its own and the note would be a claim
    // about a condition that is not present.
    const { note, written } = noteWith(false);

    // When
    note.onTestCaseResult(testCase('slow', 'Test timed out in 5000ms.'));
    note.onTestRunEnd();

    // Then
    expect(written()).toBe('');
  });

  it('should say nothing about a failure that is not a timeout', () => {
    // Given a coverage run in which an assertion failed, which instrumentation does not cause
    const { note, written } = noteWith(true);

    // When
    note.onTestCaseResult(testCase('wrong', 'expected 1 to be 2'));
    note.onTestCaseResult(testCase('fine', undefined));
    note.onTestRunEnd();

    // Then
    expect(written()).toBe('');
  });

  it('should count every timed out case and name each one', () => {
    // Given, the shape F25 was found in: the failing set is several cases across two files
    const { note, written } = noteWith(true);

    // When
    note.onTestCaseResult(testCase('first', 'Test timed out in 5000ms.'));
    note.onTestCaseResult(testCase('second', 'Hook timed out in 5000ms.'));
    note.onTestRunEnd();

    // Then
    const text = written();
    expect(text).toContain('2 cases failed by timing out');
    expect(text).toContain('first');
    expect(text).toContain('second');
  });
});
