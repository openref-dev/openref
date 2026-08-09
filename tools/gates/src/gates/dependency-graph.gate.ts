import { runCommand } from '../lib/exec.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * Runs the dependency graph rules from `.dependency-cruiser.cjs`.
 *
 * The rule set encodes STANDARDS 3.5: `core` depends on nothing, and no package reaches
 * downstream of itself.
 */
export const dependencyGraphGate: Gate = {
  id: 'dependency-graph',
  title: 'Dependency graph',

  run(context): Promise<GateResult> {
    const result = runCommand(
      'pnpm',
      ['exec', 'depcruise', 'packages', '--config', '.dependency-cruiser.cjs'],
      context.repoRoot,
    );

    const findings: GateFinding[] = [];

    if (result.ok) {
      findings.push({ level: 'info', message: 'no dependency rule violations' });
    } else {
      const output = `${result.stdout}${result.stderr}`.trim();
      findings.push({
        level: 'error',
        message: output.length > 0 ? output : `depcruise exited with ${String(result.exitCode)}`,
      });
    }

    return Promise.resolve({
      id: dependencyGraphGate.id,
      title: dependencyGraphGate.title,
      status: result.ok ? 'pass' : 'fail',
      findings,
    });
  },
};
