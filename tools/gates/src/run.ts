import { browserResolutionGate } from './gates/browser-resolution.gate.js';
import { budgetExceptionsGate } from './gates/budget-exceptions.gate.js';
import { capabilityDebtsGate } from './gates/capability-debts.gate.js';
import { buildManifestGate } from './gates/build-manifest.gate.js';
import { budgetsGate } from './gates/budgets.gate.js';
import { clientRunnerGate } from './gates/client-runner.gate.js';
import { claimsGate } from './gates/claims.gate.js';
import { coverageGate } from './gates/coverage.gate.js';
import { cspGate } from './gates/csp.gate.js';
import { dependencyGraphGate } from './gates/dependency-graph.gate.js';
import { enginesFloorGate } from './gates/engines-floor.gate.js';
import { eventsSuitesGate } from './gates/events-suites.gate.js';
import { federationSuitesGate } from './gates/federation-suites.gate.js';
import { m6SuitesGate } from './gates/m6-suites.gate.js';
import { m7SuitesGate } from './gates/m7-suites.gate.js';
import { readerPagesGate } from './gates/reader-pages.gate.js';
import { fixtureLicensesGate } from './gates/fixture-licenses.gate.js';
import { formatGate } from './gates/format.gate.js';
import { licensesGate } from './gates/licenses.gate.js';
import { publishListGate } from './gates/publish-list.gate.js';
import { staticSuitesGate } from './gates/static-suites.gate.js';
import { themeFontsGate } from './gates/theme-fonts.gate.js';
import { themeMotionGate } from './gates/theme-motion.gate.js';
import { textSourceGate } from './gates/text-source.gate.js';
import { themeTokensGate } from './gates/theme-tokens.gate.js';
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
 *
 * The publish list gate sits beside the licence and engines pair, and is the third question asked
 * of the same set. One asks what the licence obliges and one what the runtime requires; this asks
 * what the set is, which the other two had always taken as given. It runs the command a release
 * runs rather than restating its rule, because a check that reimplements `private` agrees with
 * itself whatever the manifests say, and the failure it exists for is a package that became
 * publishable by accident.
 *
 * The engines gate sits beside the licence one because both read the same published closure and
 * ask a question of every package in it. One asks what the licence obliges, the other what the
 * runtime requires, and neither can be answered by reading this repository alone.
 *
 * The theme token gate sits beside the CSP one: both scan stylesheets, one for what a policy
 * would block and one for what a theme author could not override. The theme motion gate sits
 * beside them and asks a third question of the same files: whether every theme, not only the
 * one that is code, answers reduced motion in the token layer where a checker can read it.
 *
 * The theme font gate is the fourth stylesheet reader and the only one that opens a binary. It
 * asks whether a `unicode-range` describes the subset behind it, which no amount of reading CSS
 * can answer, and it runs after the fixture gate has established that those files may be there
 * at all.
 *
 * The budget exceptions gate runs immediately after the budgets, in that order for a reason: a
 * reader sees the number first and the terms it is over on second. It is what keeps a named
 * exception from being a raised threshold, so it fails on an entry with no owner, an expired
 * one, or one whose budget is inside its limit again.
 *
 * The capability debts gate runs next, because it is the same mechanism over a different kind of
 * debt. A budget exception says a number is too big and names the milestone it must be small by;
 * this says a capability is built and unreachable and names the milestone it must be reachable
 * by, which is the eighth defect class of SPEC 0. It reads the plan and the built bundle at once,
 * because an entry expires on evidence from the artefact rather than on a measurement.
 *
 * The client runner gate reads the same built bundle the size budget weighs, and asks the one
 * question weighing it cannot: whether the try-it console of SPEC 2 has anything to send with.
 * It sits beside the budget for that reason, and it exists because for the length of one task
 * a bundle with a disabled console passed every check there was.
 *
 * The browser resolution gate sits beside the client runner gate, and the pair is the same shape:
 * both read the built bundle and ask something weighing it cannot. That one asks whether the
 * console has anything to send with; this one asks whether the chunk it lives in can be loaded at
 * all. It is here because a bare specifier in the first paint chunk killed the entry while every
 * other gate was green, which is the one failure that makes all the rest unreadable.
 *
 * The format gate sits second, beside the build manifest, because the two ask the same kind of
 * question: not whether the code is right, but whether the repository is in the state its own
 * rules describe. It reads no artifact, so it can run before anything is built, and it is here
 * at all because the rule it carries was red at HEAD for two sessions while every gate was
 * green. CI ran `format:check`; nothing the per task protocol runs did.
 *
 * The static suites gate sits after the claims one and before coverage, and the pair is a question
 * asked of two tables. Claims asks whether every SPEC 19 promise and SPEC 20 number is answered by
 * something that can go red; this asks the same of one row of SPEC 21, the row whose four
 * coverages M3 is the milestone for. It runs its suites rather than reading them, so it goes late,
 * after everything that needs no child process has already reported.
 *
 * The federation suites gate sits beside it and is the same mechanism pointed at the row M4 closes.
 * Two gates rather than one because the two rows belong to two milestones: a red row has to name
 * its own subject in the summary, and a gate titled about static builds reporting a federation
 * failure is the kind of misdirection these gates exist to remove. It runs its own suites for the
 * reason the Static one does, and leaves the milestone clause to `pnpm test:integration`.
 *
 * The M7 suites gate sits fifth in that family and is the only one that reads BUILD.md as well as
 * the specification. Its row is one, because M7 built one thing; what it adds is the milestone's
 * own scope, which no earlier gate of this family had to state: M7 closes over two tasks and its
 * third row can never tick, so the gate says so in its output and fails if the amendment section
 * that justifies the exclusion is gone. It runs its own suites for the reason the four before it
 * do, the real `nuxt generate` included, and leaves the milestone clause to `pnpm test:integration`.
 *
 * The M6 suites gate sits fourth in that family and is the only one of the four that reads more
 * than one row. `Static`, `Federation` and `Events` each close a milestone that built one thing; M6
 * built a socket client, a bridge, a sample generator and an agent surface, and `T059` asks for all
 * four wired in one sentence, so four gates would give one failure four titles. It runs its own
 * suites for the reason the three before it do, the bridge soak included, and leaves the milestone
 * clause to `pnpm test:integration`.
 *
 * The text source gate sits beside the format one, third, and the pair is the same question asked
 * twice: whether the repository is in the state its own rules describe, before anything is built.
 * One asks whether a file is formatted the way the project says; the other asks whether a text
 * tool can read the file at all, which is the condition every sweep this project has run silently
 * assumed. It runs before the gates that read artifacts because it needs none.
 */
export const GATES: readonly Gate[] = [
  buildManifestGate,
  formatGate,
  textSourceGate,
  dependencyGraphGate,
  enginesFloorGate,
  licensesGate,
  publishListGate,
  fixtureLicensesGate,
  budgetsGate,
  budgetExceptionsGate,
  capabilityDebtsGate,
  clientRunnerGate,
  browserResolutionGate,
  cspGate,
  themeTokensGate,
  themeMotionGate,
  themeFontsGate,
  claimsGate,
  staticSuitesGate,
  federationSuitesGate,
  eventsSuitesGate,
  m6SuitesGate,
  m7SuitesGate,
  readerPagesGate,
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
