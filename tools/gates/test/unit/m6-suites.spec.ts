import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  M6_MILESTONE,
  M6_MILESTONE_CLAUSES,
  M6_SUITE_COVERAGE,
  M6_SUITE_ROWS,
  SPEC_FILE,
} from '../../src/config';
import { m6SuitesGate, runM6SuitesGate } from '../../src/gates/m6-suites.gate';
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
 * The committed M6 wiring, held to the two documents it answers.
 *
 * WHAT IS UNDER TEST HERE IS THE WIRING AND WHAT IS NEW IN THIS GATE, which is the shape
 * `events-suites.spec.ts` established: `checkStaticCoverage` and `checkMilestoneClauses` are the
 * Static row's and have their planted failures in `static-suites.spec.ts`. What is new at `T059` is
 * that four SPEC 21 rows are read rather than one, and that a row the table has lost is an error
 * here rather than an empty list, which is the difference between a check that failed and a check
 * that could not run.
 *
 * THE GATE FUNCTION IS EXERCISED ON A PLANTED TREE AND NEVER ON THIS ONE, deliberately. On a clean
 * wiring it runs `vitest` over fourteen suites, which is a gate's work and not a unit test's.
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
  const root = mkdtempSync(join(tmpdir(), 'openref-m6-suites-'));
  planted = root;

  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  return root;
}

/** Every error message the gate produced on a planted root. */
function errorsOf(root: string): string[] {
  return runM6SuitesGate({ repoRoot: root })
    .findings.filter((finding) => finding.level === 'error')
    .map((finding) => finding.message);
}

describe('the committed M6 wiring', () => {
  it('should name a suite file that is there for every coverage of all four rows', () => {
    // Given the wiring this repository ships
    // When
    const missing = M6_SUITE_COVERAGE.flatMap((coverage) =>
      coverage.files.filter((file) => !existsSync(join(repoRoot, file))),
    );

    // Then four rows wire fourteen coverages, so the check below is over all of them
    expect(M6_SUITE_ROWS).toEqual(['Bridge', 'Socket', 'Samples', 'Agent']);
    expect(M6_SUITE_COVERAGE).toHaveLength(14);
    expect(missing).toEqual([]);
  });

  it('should name a suite file that is there for every clause of the milestone', () => {
    // Given
    const missing = M6_MILESTONE_CLAUSES.flatMap((clause) =>
      clause.files.filter((file) => !existsSync(join(repoRoot, file))),
    );

    // When, Then M6 is done when four sentences hold, one per task of the milestone
    expect(M6_MILESTONE_CLAUSES).toHaveLength(4);
    expect(missing).toEqual([]);
  });

  it.skipIf(!aiDocsPresent(repoRoot))(
    'should answer every coverage the four SPEC 21 rows state and invent none',
    () => {
      // Given the real documents and the real repository, which is what the gate runs on
      const spec = readFileSync(join(repoRoot, SPEC_FILE), 'utf8');
      const stated = M6_SUITE_ROWS.flatMap((row) => suiteRowOf(spec, row) ?? []);

      // When
      const issues = checkStaticCoverage(M6_SUITE_COVERAGE, {
        specNames: stated,
        row: M6_SUITE_ROWS.join(', '),
        exists: (path) => existsSync(join(repoRoot, path)),
        casesIn: (path) => caseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
        assertionlessIn: (path) =>
          assertionlessCaseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
      });

      // Then every row is there and the four together state fourteen coverages, so the agreement
      // is over all of them rather than over whichever rows happened to be found
      expect(M6_SUITE_ROWS.filter((row) => suiteRowOf(spec, row) === null)).toEqual([]);
      expect(stated).toHaveLength(14);
      expect(issues).toEqual([]);
    },
  );

  it.skipIf(!aiDocsPresent(repoRoot))(
    'should answer every clause the M6 definition of done states and invent none',
    () => {
      // Given the real documents, and the clause SPEC 22 lacked until this task wrote it
      const spec = readFileSync(join(repoRoot, SPEC_FILE), 'utf8');

      // When
      const issues = checkMilestoneClauses(M6_MILESTONE_CLAUSES, {
        milestone: M6_MILESTONE,
        clauses: milestoneClausesOf(spec, M6_MILESTONE),
        specNames: [],
        exists: (path) => existsSync(join(repoRoot, path)),
        casesIn: (path) => caseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
        assertionlessIn: (path) =>
          assertionlessCaseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
      });

      // Then M6 has one at all, which is the half `T055` recorded as missing
      expect(milestoneClausesOf(spec, M6_MILESTONE)).toHaveLength(4);
      expect(issues).toEqual([]);
    },
  );
});

describe('the M6 suites gate on a planted tree', () => {
  it.skipIf(!aiDocsPresent(repoRoot))(
    'should name a row the table has lost rather than read it as a row stating nothing',
    () => {
      // Given a specification carrying three of the four rows, with every named file present so
      // that nothing else can be the reason it fails
      const spec = readFileSync(join(repoRoot, SPEC_FILE), 'utf8');
      const withoutSocket = spec
        .split('\n')
        .filter((line) => !line.startsWith('| Socket |'))
        .join('\n');
      const files: Record<string, string> = { [SPEC_FILE]: withoutSocket };
      for (const coverage of M6_SUITE_COVERAGE) {
        for (const file of coverage.files) {
          files[file] = `${files[file] ?? ''}${coverage.cases
            .map((title) => `it('${title}', () => { expect(1).toBe(1); });\n`)
            .join('')}`;
        }
      }

      // When
      const errors = errorsOf(plant(files));

      // Then the missing row is named, rather than the gate reporting fourteen unwired coverages
      // against a row it silently read as empty
      expect(errors.some((message) => message === 'SPEC 21 has no Socket row')).toBe(true);
    },
  );

  it('should skip rather than pass where the specification is not in the checkout', () => {
    // Given a tree whose wiring is clean but which carries no `ai-docs/`, which is every clone.
    // Every wired file exists and carries every named case, with an assertion in each, so the half
    // that needs no document really did run and really did have nothing to say.
    const files: Record<string, string> = { 'package.json': '{}\n' };
    for (const coverage of [...M6_SUITE_COVERAGE, ...M6_MILESTONE_CLAUSES]) {
      for (const file of coverage.files) {
        // ACCUMULATED RATHER THAN ASSIGNED, because several coverages name the same file and the
        // last write would otherwise drop every case the earlier ones asked for.
        files[file] =
          (files[file] ?? '') +
          coverage.cases
            .map((name) => `it(${JSON.stringify(name)}, () => {\n  expect(1).toBe(1);\n});\n`)
            .join('\n');
      }
    }
    const root = plant(files);

    // When. The gate runs the suites once the wiring reads clean, and on this planted root the
    // file list is a set of fabricated files under a directory with no workspace in it, so the run
    // is expected to fail and the wiring half is asserted through the findings instead.
    const result = runM6SuitesGate({ repoRoot: root });
    const wiring = result.findings.filter(
      (finding) => finding.level === 'error' && /^\[[a-z-]+\]/.test(finding.message),
    );

    // Then no wiring issue is reported, no row is reported missing, and the message says which
    // half went unread rather than the gate passing as if it had read both
    expect(aiDocsPresent(root)).toBe(false);
    expect(wiring).toEqual([]);
    expect(result.findings.some((finding) => finding.message.startsWith('SPEC 21 has no'))).toBe(
      false,
    );
    expect(result.findings.map((finding) => finding.message).join(' ')).toContain(
      'SKIPPED, NOT PASSED',
    );
  });
});

describe('the committed wiring of the gate itself', () => {
  it('should run between the events suites gate and the M7 one', () => {
    // Given the committed order
    const order = GATES.map((gate) => gate.id);

    // When
    const position = order.indexOf(m6SuitesGate.id);

    // Then it is in the run at all, and it sits at the end of the row gate family, newest last,
    // which is the arrangement `T042`, `T047` and `T054` each wrote down rather than loosened
    expect(position).toBeGreaterThan(-1);
    expect(order[position - 1]).toBe('events-suites');
    // `T062` added the fifth member of the family, and it is named here rather than the assertion
    // loosened to "somewhere before coverage", for the reason this case already gives: what it is
    // about is the arrangement, so a gate arriving beside this one is a decision to write down.
    expect(order[position + 1]).toBe('m7-suites');
    expect(order.indexOf('coverage')).toBe(order.length - 1);
  });
});
