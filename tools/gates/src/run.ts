import { budgetsGate } from './gates/budgets.gate.js';
import { coverageGate } from './gates/coverage.gate.js';
import { cspGate } from './gates/csp.gate.js';
import { dependencyGraphGate } from './gates/dependency-graph.gate.js';
import { licensesGate } from './gates/licenses.gate.js';
import type { Gate, GateResult } from './types.js';

/**
 * The committed gates, in the order required by BUILD T001:
 * dependency graph, licenses, size budgets, CSP scan, coverage floors.
 */
export const GATES: readonly Gate[] = [
  dependencyGraphGate,
  licensesGate,
  budgetsGate,
  cspGate,
  coverageGate,
];

/** Short label printed for each status. */
export const STATUS_LABEL: Record<GateResult['status'], string> = {
  pass: 'PASS',
  fail: 'FAIL',
  skip: 'SKIP',
};

/**
 * Runs every gate in order and prints a report as it goes.
 *
 * Gates run to completion even after one fails, so a single run shows every problem.
 *
 * @param repoRoot - Absolute repository root
 * @param write - Sink for report lines, injected so tests can capture output
 * @returns Results in declaration order
 */
export async function runAllGates(
  repoRoot: string,
  write: (line: string) => void,
): Promise<GateResult[]> {
  const results: GateResult[] = [];

  for (const gate of GATES) {
    write(`\n=== ${gate.title} ===`);
    const result = await gate.run({ repoRoot });

    for (const finding of result.findings) {
      write(`  [${finding.level}] ${finding.message}`);
    }

    write(`  -> ${STATUS_LABEL[result.status]}`);
    results.push(result);
  }

  return results;
}

/**
 * Reports whether a set of results allows the build to continue.
 *
 * @param results - Gate results
 * @returns Identifiers of the gates that failed, empty when the build is green
 */
export function failedGateIds(results: readonly GateResult[]): string[] {
  return results.filter((result) => result.status === 'fail').map((result) => result.id);
}
