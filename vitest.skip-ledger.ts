/**
 * A run that skipped something says what, by name, instead of printing a number.
 *
 * THE CASE THIS IS FOR RAN ON NEITHER MACHINE FOR TWO MILESTONES. The nginx snippet in
 * `packages/static/test/integration/proxy-config-tools.spec.ts` skips when the binary is absent,
 * which it was on the workstation, and CI had never run on the working branch, so it executed
 * nowhere at all while every suite reported green. Vitest prints `Tests 1001 passed | 1 skipped`,
 * and one skipped is a number a reader steps over. Which one it was is the part that mattered.
 *
 * IT IS THE SECOND OF TWO HALVES AND THE WEAKER ONE, WHICH IS WORTH SAYING. The `test-skips` gate
 * reads the guards off the sources and holds them to a register that says which machine runs each,
 * and that half is what fails when a case runs nowhere. This half cannot fail anything: a reporter
 * observes a run, it does not judge it. What it does is make the skip visible in the place a person
 * is already looking when they run the suite, so that a case going quiet is noticed on the run it
 * goes quiet on rather than at the next audit.
 *
 * Registered alongside the default reporter rather than replacing it, exactly as
 * `vitest.timeout-note.ts` is: everything a reader normally sees is still printed.
 */

import type { Reporter, TestCase, Vitest } from 'vitest/node';

/** One case that did not run, reduced to what the ledger prints. */
interface Silent {
  readonly name: string;
  readonly file: string;
  readonly note: string;
}

/**
 * Prints one paragraph after any run in which a case did not execute.
 */
export class SkipLedger implements Reporter {
  private readonly silent: Silent[] = [];

  onInit(_vitest: Vitest): void {
    this.silent.length = 0;
  }

  onTestCaseResult(testCase: TestCase): void {
    const result = testCase.result();
    if (result.state !== 'skipped') return;

    this.silent.push({
      name: testCase.fullName,
      file: testCase.module.moduleId,
      // Vitest carries the reason a `ctx.skip(reason)` call gave. A guard written as `skipIf`
      // gives none, and saying so is better than printing an empty string: the two are different
      // states and the register in `tools/gates/src/lib/conditional-cases.ts` names both.
      note: result.note ?? 'no reason given; see the register the test-skips gate reads',
    });
  }

  onTestRunEnd(): void {
    if (this.silent.length === 0) return;

    const count = this.silent.length;
    const cases = count === 1 ? 'case' : 'cases';

    const lines = [
      '',
      `NOTE: ${String(count)} ${cases} did not run in this run, and this is which.`,
      '',
      'A skipped case and a passing case are the same colour in the summary above. Each line below',
      'is a check this run did not make. `pnpm gates` holds every one of them to a register saying',
      'which machine does run it, and fails when the answer is neither.',
      '',
      ...this.silent.map((entry) => `  ${entry.name}\n    ${entry.file}\n    ${entry.note}`),
      '',
    ];

    process.stderr.write(`${lines.join('\n')}\n`);
  }
}
