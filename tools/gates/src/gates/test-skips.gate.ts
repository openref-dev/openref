import {
  CONDITIONAL_CASES,
  CONDITIONAL_DEPENDENCIES,
  conditionalCasesFailed,
  machineOf,
  probeDependency,
  reconcileConditionalCases,
  scanConditionalCases,
} from '../lib/conditional-cases.js';
import type { Gate, GateContext, GateFinding, GateResult } from '../types.js';

/**
 * Where every case that can silence itself runs, and the rule that none may run nowhere.
 *
 * `skip-accounting.ts` ASKS THIS OF THE GATES AND NOTHING ASKED IT OF THE SUITES. A gate that
 * skips names a declared cause and is printed under its own heading on every run. A test case that
 * skips prints a number in a summary nobody reads twice, and the machine it did not run on is not
 * recorded anywhere at all. That is the whole of how one nginx case went two milestones without
 * executing on either machine while the suite stayed green.
 *
 * IT IS A GATE RATHER THAN A UNIT CASE FOR THE REASON THE PROJECTION PRIVACY SCAN IS. `pnpm gates`
 * is the command every session is told to run before declaring a slice done, so a rule that lives
 * only in a spec file is a rule that half the run never consults. It also needs to probe the
 * machine, which is a thing a gate does and a pure unit case should not.
 *
 * WHAT GOES RED, AND WHAT IS ONLY PRINTED. Both columns false is an error: nothing anywhere runs
 * it. A group in the tree the register does not name is an error, because that is how the class
 * comes back. A register entry the tree no longer has is an error. A column that this machine
 * contradicts is an error, in both directions. A group covered by exactly one of the two machines
 * is a WARNING and is listed by name with its evidence: it has run somewhere, so it is not the
 * nginx class, but it runs on one laptop and that fact should be in front of a reader rather than
 * waiting to be rediscovered.
 */
export function runTestSkipsGate(context: GateContext): GateResult {
  const findings: GateFinding[] = [];

  const found = scanConditionalCases(context.repoRoot);
  const machine = machineOf(process.platform);
  const present = new Map(
    CONDITIONAL_DEPENDENCIES.map((dependency) => [
      dependency.id,
      probeDependency(dependency, context.repoRoot),
    ]),
  );

  const issues = reconcileConditionalCases(found, { machine, present });

  const foundCases = found.reduce((total, group) => total + group.cases, 0);
  const registeredCases = CONDITIONAL_CASES.reduce((total, group) => total + group.cases, 0);

  findings.push({
    level: 'info',
    message:
      `${String(foundCases)} case(s) over ${String(found.length)} group(s) in the tree can ` +
      `silence themselves; the register carries ${String(registeredCases)} over ` +
      String(CONDITIONAL_CASES.length),
  });

  findings.push({
    level: 'info',
    message:
      machine === undefined
        ? `this platform is ${process.platform}, which is neither machine, so no column was probed`
        : `probed on ${machine}: ` +
          CONDITIONAL_DEPENDENCIES.map(
            (dependency) =>
              `${dependency.id}=${present.get(dependency.id) === true ? 'yes' : 'no'}`,
          ).join(', '),
  });

  for (const issue of issues) findings.push({ level: issue.level, message: issue.message });

  return {
    id: testSkipsGate.id,
    title: testSkipsGate.title,
    status: conditionalCasesFailed(issues) ? 'fail' : 'pass',
    findings,
  };
}

export const testSkipsGate: Gate = {
  id: 'test-skips',
  title: 'Every case that can silence itself says which machine runs it, and none runs on neither',

  run(context): Promise<GateResult> {
    return Promise.resolve(runTestSkipsGate(context));
  },
};
