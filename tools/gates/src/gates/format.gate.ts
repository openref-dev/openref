import { runCommand } from '../lib/exec.js';
import { unformattedFiles } from '../lib/format.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/** The script this gate runs, named once so the message can point at it. */
const SCRIPT = 'format:check';

/**
 * Runs `pnpm format:check`, because a rule no command the protocol runs was checking is a rule
 * that was not enforced.
 *
 * WHY THIS GATE EXISTS, AND THE FACTS RATHER THAN THE FEELING. `pnpm format:check` was red at
 * `HEAD` for two sessions on ten files. The CI workflow does run it, so the rule had a runner;
 * what it did not have was a runner inside the loop BUILD.md's protocol actually executes, which
 * is `pnpm gates` before a task may be ticked. A session could therefore write code, run every
 * gate, watch fourteen of them pass and tick a box while a committed rule was broken, and nothing
 * between the work and the tick would say a word. Found 2026-08-12, session 40.
 *
 * IT IS THE SAME SHAPE AS THE CSP FIELD NOBODY READ, one level out. There the figure was measured
 * and no gate compared it; here the check exists, the command exists, and no step between a task
 * and a green build called it. SPEC 0 carries the rule that follows from both.
 *
 * WHAT IT DOES NOT DO IS DECIDE WHAT IS FORMATTED. The list of paths is in `package.json` and is
 * held to its shape by `tools/gates/test/unit/format-allowlist.spec.ts`, which is also what keeps
 * `format` and `format:check` from drifting into two different lists. This gate runs the script
 * by name for exactly that reason.
 */
export const formatGate: Gate = {
  id: 'format',
  title: 'Every file on the format allowlist is formatted',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];
    const run = runCommand('pnpm', ['run', SCRIPT], context.repoRoot);
    const files = unformattedFiles(`${run.stdout}\n${run.stderr}`);

    for (const file of files) {
      findings.push({
        level: 'error',
        message: `${file} is not formatted. Run pnpm format`,
      });
    }

    // A NON ZERO EXIT WITH NO FILE IN IT IS THE CHECKER FAILING, and it is reported as that. A
    // missing prettier, an unreadable file and a pattern that matches nothing all land here, and
    // every one of them would otherwise read as a repository with nothing unformatted in it.
    if (!run.ok && files.length === 0) {
      findings.push({
        level: 'error',
        message:
          `pnpm run ${SCRIPT} exited ${String(run.exitCode)} and named no file, so nothing was ` +
          `checked: ${`${run.stdout}${run.stderr}`.trim().slice(-2000)}`,
      });
    }

    if (findings.length === 0) {
      findings.push({
        level: 'info',
        message: `pnpm run ${SCRIPT} is clean over the allowlist in package.json`,
      });
    }

    return Promise.resolve({
      id: formatGate.id,
      title: formatGate.title,
      status: findings.some((finding) => finding.level === 'error') ? 'fail' : 'pass',
      findings,
    });
  },
};
