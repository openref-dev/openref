import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FEDERATION_BUDGET_SUITE,
  FEDERATION_MILESTONE,
  FEDERATION_MILESTONE_CLAUSES,
  FEDERATION_SUITE_COVERAGE,
  FEDERATION_SUITE_ROW,
  SPEC_FILE,
} from '../../src/config';
import { federationSuitesGate } from '../../src/gates/federation-suites.gate';
import { aiDocsPresent } from '../../src/lib/ai-docs';
import {
  assertionlessCaseTitlesIn,
  caseTitlesIn,
  checkMilestoneClauses,
  checkStaticCoverage,
  checkSuiteFiles,
  milestoneClausesOf,
  suiteRowOf,
} from '../../src/lib/static-suites';
import { GATES } from '../../src/run';

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');

/**
 * The committed federation wiring, held to the two documents it answers.
 *
 * WHAT IS UNDER TEST HERE IS THE WIRING AND NOT THE MECHANISM. `checkStaticCoverage` and
 * `checkMilestoneClauses` are the Static row's, with their own cases in `static-suites.spec.ts`
 * including the planted failures; what is new at `T047` is a second row wired to suites, a
 * milestone whose one clause has a case naming it, and a gate registered to run them. Those three
 * are what these cases read, against the real specification and the real repository, which is the
 * only reading that can go stale.
 */
describe('the committed federation wiring', () => {
  it('should name a suite file that is there for every coverage', () => {
    // Given the wiring this repository ships
    // When
    const missing = FEDERATION_SUITE_COVERAGE.flatMap((coverage) =>
      coverage.files.filter((file) => !existsSync(join(repoRoot, file))),
    );

    // Then
    expect(FEDERATION_SUITE_COVERAGE).toHaveLength(3);
    expect(missing).toEqual([]);
  });

  it.skipIf(!aiDocsPresent(repoRoot))(
    'should answer every coverage the SPEC 21 Federation row states and invent none',
    () => {
      // Given the real documents and the real repository, which is what the gate runs on
      const spec = readFileSync(join(repoRoot, SPEC_FILE), 'utf8');

      // When
      const issues = checkStaticCoverage(FEDERATION_SUITE_COVERAGE, {
        specNames: suiteRowOf(spec, FEDERATION_SUITE_ROW),
        exists: (path) => existsSync(join(repoRoot, path)),
        casesIn: (path) => caseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
        assertionlessIn: (path) =>
          assertionlessCaseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
      });

      // Then the row really states three coverages, so the agreement below is over all of them
      expect(suiteRowOf(spec, FEDERATION_SUITE_ROW)).toHaveLength(3);
      expect(issues).toEqual([]);
    },
  );

  it.skipIf(!aiDocsPresent(repoRoot))(
    'should answer the clause the M4 definition of done states and invent none',
    () => {
      // Given the real documents and the real repository
      const spec = readFileSync(join(repoRoot, SPEC_FILE), 'utf8');

      // When
      const issues = checkMilestoneClauses(FEDERATION_MILESTONE_CLAUSES, {
        milestone: FEDERATION_MILESTONE,
        clauses: milestoneClausesOf(spec, FEDERATION_MILESTONE),
        specNames: [],
        exists: (path) => existsSync(join(repoRoot, path)),
        casesIn: (path) => caseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
        assertionlessIn: (path) =>
          assertionlessCaseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
      });

      // Then M4 is done when one sentence holds, and that sentence has a case with its name on it
      expect(milestoneClausesOf(spec, FEDERATION_MILESTONE)).toHaveLength(1);
      expect(issues).toEqual([]);
    },
  );

  it('should hold the tripled budget suite by the repository half, so deleting it goes red', () => {
    // Given the wiring this repository ships, which needs no specification to be checked
    // When
    const issues = checkSuiteFiles(FEDERATION_BUDGET_SUITE, {
      specNames: [],
      exists: (path) => existsSync(join(repoRoot, path)),
      casesIn: (path) => caseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
      assertionlessIn: (path) =>
        assertionlessCaseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
    });

    // Then the suite the gate owes is named, present, and none of its named cases is empty
    expect(FEDERATION_BUDGET_SUITE.flatMap((suite) => suite.files)).toContain(
      'packages/nest/test/integration/federation-budget.spec.ts',
    );
    expect(issues).toEqual([]);
  });

  it('should be registered between the static suites gate and coverage', () => {
    // Given the committed order
    const order = GATES.map((gate) => gate.id);

    // When
    const position = order.indexOf(federationSuitesGate.id);

    // Then it is in the run at all, and it is beside the gate whose mechanism it reuses
    expect(position).toBeGreaterThan(-1);
    expect(order[position - 1]).toBe('static-suites');
    expect(order[position + 1]).toBe('coverage');
  });
});
