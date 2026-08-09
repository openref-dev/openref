import { buildManifestGate } from './gates/build-manifest.gate.js';
import { budgetsGate } from './gates/budgets.gate.js';
import { coverageGate } from './gates/coverage.gate.js';
import { cspGate } from './gates/csp.gate.js';
import { dependencyGraphGate } from './gates/dependency-graph.gate.js';
import { fixtureLicensesGate } from './gates/fixture-licenses.gate.js';
import { licensesGate } from './gates/licenses.gate.js';
import type { Gate, GateResult } from './types.js';

/**
 * The committed gates, in order.
 *
 * The build manifest goes first: every later gate reports on code written against a task
 * description read out of BUILD.md by line number, so a shifted BUILD.md makes the rest of
 * the run a report on the wrong work. Then the order required by BUILD T001: dependency
 * graph, licenses, size budgets, CSP scan, coverage floors.
 *
 * The fixture license gate sits beside the dependency one rather than inside it. SPEC 0 has
 * three zones, and zones 1 and 2 are answered by walking the dependency tree while zone 3 is
 * answered by walking vendored files. Two questions, two walks, two reports.
 */
export const GATES: readonly Gate[] = [
  buildManifestGate,
  dependencyGraphGate,
  licensesGate,
  fixtureLicensesGate,
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
 * Selects gates by id, keeping the declared order.
 *
 * Used by jobs that need one gate on its own, such as the license check in the release
 * job. Selection never reorders and never skips silently: an unknown id is an error.
 *
 * @param ids - Gate ids, empty for all of them
 * @returns The selected gates in declared order
 * @throws Error when an id matches no gate
 */
export function selectGates(ids: readonly string[]): readonly Gate[] {
  if (ids.length === 0) return GATES;

  const known = new Set(GATES.map((gate) => gate.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `unknown gate(s): ${unknown.join(', ')}. Known gates: ${GATES.map((gate) => gate.id).join(', ')}`,
    );
  }

  return GATES.filter((gate) => ids.includes(gate.id));
}

/**
 * Runs gates in order and prints a report as it goes.
 *
 * Gates run to completion even after one fails, so a single run shows every problem.
 *
 * @param repoRoot - Absolute repository root
 * @param write - Sink for report lines, injected so tests can capture output
 * @param ids - Gate ids to run, empty for all of them
 * @returns Results in declaration order
 */
export async function runAllGates(
  repoRoot: string,
  write: (line: string) => void,
  ids: readonly string[] = [],
): Promise<GateResult[]> {
  const results: GateResult[] = [];

  for (const gate of selectGates(ids)) {
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
