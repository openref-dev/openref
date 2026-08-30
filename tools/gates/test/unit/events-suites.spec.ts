import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EVENTS_MILESTONE,
  EVENTS_MILESTONE_CLAUSES,
  EVENTS_SUITE_COVERAGE,
  EVENTS_SUITE_ROW,
  SPEC_FILE,
} from '../../src/config';
import { eventsSuitesGate, runEventsSuitesGate } from '../../src/gates/events-suites.gate';
import { aiDocsPresent } from '../../src/lib/ai-docs';
import {
  assertionlessCaseTitlesIn,
  caseTitlesIn,
  checkMilestoneClauses,
  checkStaticCoverage,
  milestoneClausesOf,
  suiteRowOf,
} from '../../src/lib/static-suites';
import { GATES } from '../../src/run';

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');

/**
 * The committed events wiring, held to the two documents it answers.
 *
 * WHAT IS UNDER TEST HERE IS THE WIRING AND NOT THE MECHANISM, which is the shape
 * `federation-suites.spec.ts` established: `checkStaticCoverage` and `checkMilestoneClauses` are
 * the Static row's and have their planted failures in `static-suites.spec.ts`. What is new at
 * `T054` is a third row wired to suites, a milestone whose two clauses have cases naming them, and
 * a gate registered to run them.
 *
 * THE GATE FUNCTION IS EXERCISED ON A PLANTED TREE AND NEVER ON THIS ONE, deliberately. It runs
 * `vitest` over four suites when the wiring reads clean, which is a gate's work and not a unit
 * test's; a planted root where the wiring does not read reaches every branch except that run, and
 * the run itself is what `pnpm gates` proves once per session.
 */

let planted: string | undefined;

afterEach(() => {
  if (planted !== undefined) rmSync(planted, { recursive: true, force: true });
  planted = undefined;
});

/**
 * A repository root holding the named files and nothing else.
 *
 * @param files - Repository relative paths to write, with their content
 * @returns Absolute path of the planted root
 */
function plant(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'openref-events-suites-'));
  planted = root;

  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  return root;
}

/** Every rule id the gate reported as an error, sorted and de-duplicated. */
function rulesOf(root: string): string[] {
  return [
    ...new Set(
      runEventsSuitesGate({ repoRoot: root })
        .findings.filter((finding) => finding.level === 'error')
        .map((finding) => /^\[([a-z-]+)\]/.exec(finding.message)?.[1] ?? '?'),
    ),
  ].sort();
}

describe('the committed events wiring', () => {
  it('should name a suite file that is there for every coverage', () => {
    // Given the wiring this repository ships
    // When
    const missing = EVENTS_SUITE_COVERAGE.flatMap((coverage) =>
      coverage.files.filter((file) => !existsSync(join(repoRoot, file))),
    );

    // Then the row really wires four coverages, so the check below is over all of them
    expect(EVENTS_SUITE_COVERAGE).toHaveLength(4);
    expect(missing).toEqual([]);
  });

  it('should name a suite file that is there for every clause of the milestone', () => {
    // Given
    const missing = EVENTS_MILESTONE_CLAUSES.flatMap((clause) =>
      clause.files.filter((file) => !existsSync(join(repoRoot, file))),
    );

    // When, Then M5 is done when two sentences hold
    expect(EVENTS_MILESTONE_CLAUSES).toHaveLength(2);
    expect(missing).toEqual([]);
  });

  it.skipIf(!aiDocsPresent(repoRoot))(
    'should answer every coverage the SPEC 21 Events row states and invent none',
    () => {
      // Given the real documents and the real repository, which is what the gate runs on
      const spec = readFileSync(join(repoRoot, SPEC_FILE), 'utf8');

      // When
      const issues = checkStaticCoverage(EVENTS_SUITE_COVERAGE, {
        specNames: suiteRowOf(spec, EVENTS_SUITE_ROW),
        row: EVENTS_SUITE_ROW,
        exists: (path) => existsSync(join(repoRoot, path)),
        casesIn: (path) => caseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
        assertionlessIn: (path) =>
          assertionlessCaseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
      });

      // Then the row is there and states four coverages, so the agreement is over all of them
      expect(suiteRowOf(spec, EVENTS_SUITE_ROW)).toHaveLength(4);
      expect(issues).toEqual([]);
    },
  );

  it.skipIf(!aiDocsPresent(repoRoot))(
    'should answer both clauses the M5 definition of done states and invent none',
    () => {
      // Given the real documents and the real repository
      const spec = readFileSync(join(repoRoot, SPEC_FILE), 'utf8');

      // When
      const issues = checkMilestoneClauses(EVENTS_MILESTONE_CLAUSES, {
        milestone: EVENTS_MILESTONE,
        clauses: milestoneClausesOf(spec, EVENTS_MILESTONE),
        specNames: [],
        exists: (path) => existsSync(join(repoRoot, path)),
        casesIn: (path) => caseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
        assertionlessIn: (path) =>
          assertionlessCaseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
      });

      // Then
      expect(milestoneClausesOf(spec, EVENTS_MILESTONE)).toHaveLength(2);
      expect(issues).toEqual([]);
    },
  );
});

describe('the events suites gate', () => {
  it('should fail on a suite file that is not in the repository', () => {
    // Given a tree with none of the wired suites in it, and no documents either, so what reports
    // is the half that needs no document
    const root = plant({ 'package.json': '{}\n' });

    // When
    const rules = rulesOf(root);

    // Then it names the missing file rather than passing for having read nothing
    expect(rules).toContain('suite-missing');
    expect(runEventsSuitesGate({ repoRoot: root }).status).toBe('fail');
  });

  it('should fail on a suite emptied of the case that names the coverage', () => {
    // Given every wired file present and holding no case at all, which is what a renamed case
    // looks like from here and is the failure the named case list exists for
    const files: Record<string, string> = { 'package.json': '{}\n' };
    for (const coverage of [...EVENTS_SUITE_COVERAGE, ...EVENTS_MILESTONE_CLAUSES]) {
      for (const file of coverage.files) files[file] = "import { it } from 'vitest';\n";
    }
    const root = plant(files);

    // When
    const rules = rulesOf(root);

    // Then the files are all there, so what fails is the case and not the path
    expect(rules).not.toContain('suite-missing');
    expect(rules).toContain('case-missing');
  });

  it('should skip rather than pass where the specification is not in the checkout', () => {
    // Given a tree whose wiring is clean but which carries no `ai-docs/`, which is every clone.
    // Every wired file exists and carries every named case, with an assertion in each, so the
    // half that needs no document really did run and really did have nothing to say.
    const files: Record<string, string> = { 'package.json': '{}\n' };
    for (const coverage of [...EVENTS_SUITE_COVERAGE, ...EVENTS_MILESTONE_CLAUSES]) {
      for (const file of coverage.files) {
        // ACCUMULATED RATHER THAN ASSIGNED, because several coverages name the same file and the
        // last write would otherwise drop every case the earlier ones asked for. That is the
        // shape of the wiring, so a plant that did not reproduce it would prove nothing.
        files[file] =
          (files[file] ?? '') +
          coverage.cases
            .map((name) => `it(${JSON.stringify(name)}, () => {\n  expect(1).toBe(1);\n});\n`)
            .join('\n');
      }
    }
    const root = plant(files);

    // When. `runEventsSuitesGate` runs the suites when the wiring reads clean, and on this planted
    // root the file list is a set of fabricated files under a directory with no vitest in it, so
    // the run is expected to fail and the status is asserted through the findings instead.
    const result = runEventsSuitesGate({ repoRoot: root });
    const wiring = result.findings.filter(
      (finding) => finding.level === 'error' && /^\[[a-z-]+\]/.test(finding.message),
    );

    // Then no wiring issue is reported, and the skip message says which half went unread
    expect(aiDocsPresent(root)).toBe(false);
    expect(wiring).toEqual([]);
    expect(result.findings.map((finding) => finding.message).join(' ')).toContain(
      'THE SKIP COVERS THE SPEC HALF ONLY',
    );
  });

  it('should be registered between the federation suites gate and the M6 one', () => {
    // Given the committed order
    const order = GATES.map((gate) => gate.id);

    // When
    const position = order.indexOf(eventsSuitesGate.id);

    // Then it is in the run at all, and it sits with the gates whose mechanism it reuses. The
    // neighbour on the right moved at `T059`, when `m6-suites` joined the family: the row gates run
    // in milestone order, newest last, and the arrangement is written down rather than loosened to
    // "somewhere before coverage", which is what these cases have said since `T047`.
    expect(position).toBeGreaterThan(-1);
    expect(order[position - 1]).toBe('federation-suites');
    expect(order[position + 1]).toBe('m6-suites');
  });
});
