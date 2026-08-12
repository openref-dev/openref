/**
 * A timeout under the coverage run says that it is the coverage run.
 *
 * FINDING F25, AND THE FIX IS LEGIBILITY RATHER THAN A HIGHER BOUND. Three cases went red on
 * 2026-08-11 in the coverage gate and nowhere else, and the failing set moved between runs on one
 * machine: `dependency-rules.spec.ts` and `package-coverage.spec.ts` timed out on the second run
 * with nothing changed, and the third run was green. The coverage run is the only run that takes
 * the integration suite and V8 instrumentation together, so it is the only place vitest's five
 * second default is close. Session 22 met the same thing once.
 *
 * RAISING THE TIMEOUT WAS REFUSED, DELIBERATELY. A load sensitive default is a real signal about
 * how much work a case does, and a bound raised until nothing fires converts that signal into
 * silence. What was wrong was not the number: it was that the failure presented as an assertion
 * about the product having broken, so each session that met it rediscovered the class from
 * scratch. This reporter says the sentence instead.
 *
 * IT NEVER SAYS THE FAILURE IS FINE. A timeout under coverage can be a real defect, and the note
 * gives the one command that tells the two apart rather than an excuse for either.
 */

import type { Reporter, TestCase, Vitest } from 'vitest/node';

/** What vitest writes into the message of a timed out test or hook. */
const TIMEOUT_MESSAGE = /timed out in \d+\s*ms/i;

/** One timed out case, reduced to what the note prints. */
interface TimedOut {
  readonly name: string;
  readonly file: string;
}

/** Whether a failure is a timeout rather than an assertion. */
function isTimeout(errors: readonly { message?: string }[] | undefined): boolean {
  return (errors ?? []).some((error) => TIMEOUT_MESSAGE.test(error.message ?? ''));
}

/**
 * Prints one paragraph after a coverage run in which something timed out.
 *
 * Registered alongside the default reporter rather than replacing it: everything a reader
 * normally sees is still printed, and this adds a line under it when it has one to add.
 */
export class CoverageTimeoutNote implements Reporter {
  private coverage = false;

  private readonly timedOut: TimedOut[] = [];

  onInit(vitest: Vitest): void {
    this.coverage = vitest.config.coverage.enabled;
    this.timedOut.length = 0;
  }

  onTestCaseResult(testCase: TestCase): void {
    const result = testCase.result();
    if (result.state !== 'failed' || !isTimeout(result.errors)) return;

    this.timedOut.push({ name: testCase.fullName, file: testCase.module.moduleId });
  }

  onTestRunEnd(): void {
    if (!this.coverage || this.timedOut.length === 0) return;

    const count = this.timedOut.length;
    const cases = count === 1 ? 'case' : 'cases';

    const lines = [
      '',
      `NOTE: ${String(count)} ${cases} failed by timing out, and this is the coverage run.`,
      '',
      'V8 instrumentation is active here and in no other run, so every spawned process and every',
      'dependency cruise takes longer than it does under `pnpm test`. Several cases across this',
      'repository sit close to the five second default in that condition, and which of them goes',
      'red moves between runs on one machine. This is a known interaction, recorded as F25, and it',
      'is not by itself evidence that anything under test has changed.',
      '',
      'It is also not a reason to disregard the failure. To tell the two apart, run `pnpm test`',
      'and `pnpm test:integration`, which carry no instrumentation: green there and red here is',
      'the interaction, red in both is a real failure and the timeout is where it surfaced.',
      '',
      ...this.timedOut.map((entry) => `  ${entry.name}\n    ${entry.file}`),
      '',
    ];

    process.stderr.write(`${lines.join('\n')}\n`);
  }
}
