import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MILESTONE_CLAUSE_COVERAGE,
  MILESTONE_UNDER_GATE,
  SPEC_FILE,
  STATIC_BUDGET_JOB,
  STATIC_SUITE_COVERAGE,
  STATIC_SUITE_ROW,
} from '../../src/config';
import { staticSuitesGate } from '../../src/gates/static-suites.gate';
import { aiDocsPresent } from '../../src/lib/ai-docs';
import {
  assertionlessCaseTitlesIn,
  caseTitlesIn,
  checkSuiteFiles,
  checkBudgetJob,
  checkMilestoneClauses,
  checkStaticCoverage,
  milestoneClausesOf,
  suiteRowOf,
  type MilestoneClauseContext,
  type StaticCoverage,
  type StaticSuiteContext,
} from '../../src/lib/static-suites';
import { GATES } from '../../src/run';

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');

/**
 * The wiring between SPEC 21's Static row and the suites that answer it, and every way it rots.
 *
 * THE HAZARD A GATE LIKE THIS CARRIES IS THAT IT AGREES WITH ITSELF. A check whose subject is a
 * list it also declares proves the copy, not the rule, so the cases below plant each failure and
 * watch it fail before the committed tree is asked anything. The committed cases come last and are
 * positive controls over a subject the planted ones have already shown can go red.
 */
const SPEC_21 = [
  '## 21. Тесты',
  '',
  '| Набор | Покрытие |',
  '|---|---|',
  '| Детерминизм | 1000 перемешанных вариантов |',
  '| Static | детерминированность, инкрементальность, SEO-разметка, конфиги прокси |',
  '| Licenses | всё дерево зависимостей |',
  '',
  '## 22. Вехи',
  '',
].join('\n');

const WIRED: readonly StaticCoverage[] = [
  {
    id: 'determinism',
    spec: 'детерминированность',
    files: ['a.spec.ts'],
    cases: ['should write byte identical output'],
  },
  {
    id: 'incrementality',
    spec: 'инкрементальность',
    files: ['b.spec.ts'],
    cases: ['should carry a page'],
  },
  {
    id: 'seo-markup',
    spec: 'SEO-разметка',
    files: ['c.spec.ts'],
    cases: ['should carry a canonical link'],
  },
  {
    id: 'proxy-configs',
    spec: 'конфиги прокси',
    files: ['d.spec.ts'],
    cases: ['should pin every upstream'],
  },
];

/** Titles the planted suites carry, so every coverage is answered unless a case says otherwise. */
const TITLES: Readonly<Record<string, readonly string[]>> = {
  'a.spec.ts': ['should write byte identical output'],
  'b.spec.ts': ['should carry a page'],
  'c.spec.ts': ['should carry a canonical link'],
  'd.spec.ts': ['should pin every upstream'],
};

/**
 * A context in which the wiring above is sound, so each case changes exactly one thing.
 *
 * @param overrides - What this case changes
 * @returns The context
 */
function context(overrides: Partial<StaticSuiteContext> = {}): StaticSuiteContext {
  return {
    specNames: suiteRowOf(SPEC_21, 'Static'),
    exists: (path) => path in TITLES,
    casesIn: (path) => TITLES[path] ?? [],
    assertionlessIn: () => [],
    ...overrides,
  };
}

const WORKFLOW = [
  'name: CI',
  'on:',
  '  push:',
  'jobs:',
  '  verify:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: pnpm run test',
  '  static-build-budget:',
  '    runs-on: ubuntu-latest',
  '    env:',
  "      OPENREF_STATIC_BUDGET_CORES: '4'",
  '    steps:',
  '      - run: pnpm exec vitest run packages/static/test/integration/build-budget.spec.ts',
  '',
].join('\n');

describe('suiteRowOf', () => {
  it('should read the coverage names one row of the SPEC 21 table states', () => {
    // Given
    // When
    const names = suiteRowOf(SPEC_21, 'Static');

    // Then
    expect(names).toEqual([
      'детерминированность',
      'инкрементальность',
      'SEO-разметка',
      'конфиги прокси',
    ]);
  });

  it('should answer null for a row that is not there, rather than an empty list', () => {
    // Given, since an empty list would read as a table stating no coverage at all, which is a
    // requirement met by anything
    // When
    // Then
    expect(suiteRowOf(SPEC_21, 'Federation')).toBeNull();
    expect(suiteRowOf('## 1. Something\n', 'Static')).toBeNull();
  });
});

describe('assertionlessCaseTitlesIn', () => {
  it('should name a case whose body asserts nothing and leave its neighbours alone', () => {
    // Given a suite where the middle case has been emptied, which is the shape the pre-M4 review
    // found this file's check blind to: the title stays, the coverage stays green, nothing is
    // proved
    const source = [
      "it('should hold the first property', () => {",
      '  expect(1).toBe(1);',
      '});',
      "it('should hold the gutted property', () => {});",
      "it('should hold the last property', () => {",
      '  expect(2).toBe(2);',
      '});',
    ].join('\n');

    // When
    const gutted = assertionlessCaseTitlesIn(source);

    // Then
    expect(gutted).toEqual(['should hold the gutted property']);
  });

  it('should not credit a case with the assertions of the case after it', () => {
    // Given the emptied case last but one, so an over-reading body would swallow the next title
    const source = [
      "it('should hold the gutted property', () => {});",
      "it('should hold the real property', () => {",
      '  expect(1).toBe(1);',
      '});',
    ].join('\n');

    // When
    const gutted = assertionlessCaseTitlesIn(source);

    // Then
    expect(gutted).toEqual(['should hold the gutted property']);
  });
});

describe('checkSuiteFiles, a gutted case', () => {
  it('should report a named case that asserts nothing rather than counting it as coverage', () => {
    // Given a coverage whose file and case are both present, and the case is empty
    const coverages = [
      { id: 'determinism', spec: 'x', files: ['a.spec.ts'], cases: ['should carry something'] },
    ];

    // When
    const issues = checkSuiteFiles(coverages, {
      ...context(),
      exists: () => true,
      casesIn: () => ['should carry something'],
      assertionlessIn: () => ['should carry something'],
    });

    // Then one finding, and it names the cause rather than saying the case is missing
    expect(issues.map((issue) => issue.rule)).toEqual(['case-gutted']);
    expect(issues[0]?.message).toContain('asserts nothing');
  });

  it('should say nothing about a gutted case no coverage names', () => {
    // Given the emptied case is some other case in the same file
    const coverages = [
      { id: 'determinism', spec: 'x', files: ['a.spec.ts'], cases: ['should carry something'] },
    ];

    // When
    const issues = checkSuiteFiles(coverages, {
      ...context(),
      exists: () => true,
      casesIn: () => ['should carry something', 'should do something else'],
      assertionlessIn: () => ['should do something else'],
    });

    // Then
    expect(issues).toEqual([]);
  });
});

describe('caseTitlesIn', () => {
  it('should read the three spellings a suite in this repository uses', () => {
    // Given the plain form, the bounded form and the multiline form with a timeout after it
    const source = [
      "it('should do the plain thing', () => {});",
      "it.skipIf(!HAVE_AI_DOCS)('should do the bounded thing', () => {});",
      'it(',
      "  'should do the multiline thing',",
      '  async () => {},',
      '  60_000,',
      ');',
    ].join('\n');

    // When
    const titles = caseTitlesIn(source);

    // Then
    expect(titles).toEqual([
      'should do the plain thing',
      'should do the bounded thing',
      'should do the multiline thing',
    ]);
  });
});

describe('checkStaticCoverage, planted', () => {
  it('should be silent when the row, the wiring and the repository agree', () => {
    // Given
    // When
    const issues = checkStaticCoverage(WIRED, context());

    // Then
    expect(issues).toEqual([]);
  });

  it('should fail on a coverage SPEC 21 requires and nothing here answers', () => {
    // Given the table gaining a fifth word, which is how a requirement arrives
    const named = [...(suiteRowOf(SPEC_21, 'Static') ?? []), 'изоляция'];

    // When
    const issues = checkStaticCoverage(WIRED, context({ specNames: named }));

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['coverage-unwired']);
    expect(issues[0]?.message).toContain('изоляция');
  });

  it('should fail on a coverage wired here that the table does not state', () => {
    // Given the other direction, which is a gate checking something nobody asked for while
    // carrying the authority of the table
    const invented: StaticCoverage[] = [
      ...WIRED,
      { id: 'invented', spec: 'выдумка', files: ['a.spec.ts'], cases: [] },
    ];

    // When
    const issues = checkStaticCoverage(invented, context());

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['coverage-unstated']);
  });

  it('should fail when the row itself cannot be read, rather than reporting the wiring sound', () => {
    // Given the table moved or the row deleted. Reporting four green coverages against a
    // requirement nobody found is the absence defect in its purest form.
    // When
    const issues = checkStaticCoverage(WIRED, context({ specNames: null }));

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['spec-row-missing']);
  });

  it('should fail on a suite file that is not in the repository', () => {
    // Given a renamed suite, which leaves the coverage unproved and this list saying otherwise
    // When
    const issues = checkStaticCoverage(WIRED, context({ exists: (path) => path !== 'c.spec.ts' }));

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['suite-missing', 'case-missing']);
    expect(issues[0]?.message).toContain('c.spec.ts');
  });

  it('should fail on a suite emptied of the case that names the property', () => {
    // Given the file still there and the property gone, which no path check can see
    // When
    const issues = checkStaticCoverage(
      WIRED,
      context({ casesIn: (path) => (path === 'd.spec.ts' ? [] : (TITLES[path] ?? [])) }),
    );

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['case-missing']);
    expect(issues[0]?.message).toContain('should pin every upstream');
  });

  it('should fail on a coverage wired to no suite at all, since it could never fail', () => {
    // Given
    const hollow = WIRED.map((coverage) =>
      coverage.id === 'seo-markup' ? { ...coverage, files: [] } : coverage,
    );

    // When
    const issues = checkStaticCoverage(hollow, context());

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['coverage-empty']);
  });

  it('should not answer the row half at all where the specification is absent', () => {
    // Given a checkout with no private documents. The other halves still run there; inventing a
    // verdict about a document nobody has is what a skip exists to avoid.
    // When
    const issues = checkStaticCoverage(WIRED, context({ specNames: [], compareWithSpec: false }));

    // Then
    expect(issues).toEqual([]);
  });
});

/** SPEC 22 as far as this gate reads it: one milestone with a three clause done-when. */
const SPEC_22 = [
  '## 22. Вехи',
  '',
  '### M2 - Runner',
  '**Готово, когда:** контрактные тесты зелёные.',
  '',
  '### M3 - CLI и CI',
  '`doctor`, `lint`, `diff`.',
  '**Готово, когда:** первое условие; второе условие; третье условие.',
  '',
  '### M4 - Федерация',
  '**Готово, когда:** демо из трёх сервисов работает как одна страница.',
  '',
].join('\n');

const CLAUSES: readonly StaticCoverage[] = [
  { id: 'first', spec: 'первое условие', files: ['a.spec.ts'], cases: [] },
  { id: 'second', spec: 'второе условие', files: ['b.spec.ts'], cases: ['should carry a page'] },
  { id: 'third', spec: 'третье условие', files: ['c.spec.ts'], cases: [] },
];

/**
 * A context in which the clause wiring above is sound, so each case changes one thing.
 *
 * @param overrides - What this case changes
 * @returns The context
 */
function clauseContext(overrides: Partial<MilestoneClauseContext> = {}): MilestoneClauseContext {
  return {
    milestone: 'M3',
    clauses: milestoneClausesOf(SPEC_22, 'M3'),
    specNames: [],
    exists: (path) => path in TITLES,
    casesIn: (path) => TITLES[path] ?? [],
    assertionlessIn: () => [],
    ...overrides,
  };
}

describe('milestoneClausesOf', () => {
  it('should read the clauses one milestone definition of done states', () => {
    // Given
    // When
    const clauses = milestoneClausesOf(SPEC_22, 'M3');

    // Then, the trailing full stop is not part of the last clause, and the neighbouring
    // milestones are not read into it
    expect(clauses).toEqual(['первое условие', 'второе условие', 'третье условие']);
  });

  it('should read a one clause milestone as one clause rather than as none', () => {
    // Given
    // When
    // Then
    expect(milestoneClausesOf(SPEC_22, 'M4')).toEqual([
      'демо из трёх сервисов работает как одна страница',
    ]);
  });

  it('should answer null for a milestone or a done-when that is not there', () => {
    // Given, since an empty list would read as a milestone judged on nothing, which anything meets
    // When
    // Then
    expect(milestoneClausesOf(SPEC_22, 'M9')).toBeNull();
    expect(milestoneClausesOf('### M3 - CLI\nСписок задач.\n', 'M3')).toBeNull();
  });
});

describe('checkMilestoneClauses, planted', () => {
  it('should be silent when the done-when, the wiring and the repository agree', () => {
    // Given
    // When
    const issues = checkMilestoneClauses(CLAUSES, clauseContext());

    // Then
    expect(issues).toEqual([]);
  });

  it('should fail on a clause the milestone states and no suite here answers', () => {
    // Given the sentence gaining a fourth clause, which is how a requirement arrives
    const stated = [...(milestoneClausesOf(SPEC_22, 'M3') ?? []), 'четвёртое условие'];

    // When
    const issues = checkMilestoneClauses(CLAUSES, clauseContext({ clauses: stated }));

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['clause-unwired']);
    expect(issues[0]?.message).toContain('четвёртое условие');
  });

  it('should fail on a clause wired here that the milestone does not state', () => {
    // Given the other direction: a gate holding a milestone to a sentence nobody wrote
    const invented: StaticCoverage[] = [
      ...CLAUSES,
      { id: 'invented', spec: 'выдумка', files: ['a.spec.ts'], cases: [] },
    ];

    // When
    const issues = checkMilestoneClauses(invented, clauseContext());

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['clause-unstated']);
  });

  it('should fail when the done-when itself cannot be read, rather than reporting the wiring sound', () => {
    // Given the milestone moved or its sentence deleted
    // When
    const issues = checkMilestoneClauses(CLAUSES, clauseContext({ clauses: null }));

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['milestone-missing']);
    expect(issues[0]?.message).toContain('M3');
  });

  it('should fail when the case naming a clause is renamed away, which is the whole point', () => {
    // Given the file still there and the case renamed, which is the silence this list closes: a
    // clause answered by a case with no clause name could be renamed and nothing would say so
    // When
    const issues = checkMilestoneClauses(
      CLAUSES,
      clauseContext({
        casesIn: (path) => (path === 'b.spec.ts' ? ['should carry something'] : []),
      }),
    );

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['case-missing']);
    expect(issues[0]?.message).toContain('should carry a page');
  });

  it('should not answer the document half at all where the specification is absent', () => {
    // Given a checkout with no private documents, per the row half's own rule
    // When
    const issues = checkMilestoneClauses(
      CLAUSES,
      clauseContext({ clauses: [], compareWithSpec: false }),
    );

    // Then
    expect(issues).toEqual([]);
  });
});

describe('checkBudgetJob, planted', () => {
  it('should be silent when the job pins a runner, runs the suite and declares its size', () => {
    // Given
    // When
    const issues = checkBudgetJob(WORKFLOW, STATIC_BUDGET_JOB);

    // Then
    expect(issues).toEqual([]);
  });

  it('should fail when the job is gone, because certification then stops with nothing saying so', () => {
    // Given the job deleted. The suite would go on passing everywhere and would stop certifying
    // anywhere, which looks exactly like a green run.
    const without = WORKFLOW.replace('  static-build-budget:', '  something-else:');

    // When
    const issues = checkBudgetJob(without, STATIC_BUDGET_JOB);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['budget-job-missing']);
  });

  it('should fail when the job never runs the suite it exists for', () => {
    // Given
    const hollow = WORKFLOW.replace(
      'pnpm exec vitest run packages/static/test/integration/build-budget.spec.ts',
      'pnpm run test',
    );

    // When
    const issues = checkBudgetJob(hollow, STATIC_BUDGET_JOB);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['suite-not-run']);
  });

  it('should fail when the runner size is undeclared or declared as something else', () => {
    // Given the two ways the figure stops being about the machine SPEC 20 names
    const silent = WORKFLOW.replace("      OPENREF_STATIC_BUDGET_CORES: '4'\n", '');
    const wrong = WORKFLOW.replace(
      "OPENREF_STATIC_BUDGET_CORES: '4'",
      "OPENREF_STATIC_BUDGET_CORES: '2'",
    );

    // When
    const undeclared = checkBudgetJob(silent, STATIC_BUDGET_JOB);
    const mismatched = checkBudgetJob(wrong, STATIC_BUDGET_JOB);

    // Then
    expect(undeclared.map((issue) => issue.rule)).toEqual(['cores-undeclared']);
    expect(mismatched.map((issue) => issue.rule)).toEqual(['cores-mismatch']);
  });

  it('should fail when the job pins no single runner label', () => {
    // Given a matrix or a missing key, either of which leaves the machine undecided
    const floating = WORKFLOW.replace(
      '  static-build-budget:\n    runs-on: ubuntu-latest',
      '  static-build-budget:',
    );

    // When
    const issues = checkBudgetJob(floating, STATIC_BUDGET_JOB);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['runner-unpinned']);
  });

  it('should say so when the workflow will not parse, rather than reporting the job sound', () => {
    // Given
    // When
    const issues = checkBudgetJob('jobs:\n  a:\n   - [unclosed\n', STATIC_BUDGET_JOB);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['workflow-unreadable']);
  });
});

describe('the committed wiring', () => {
  it('should name a suite file that is there for every coverage', () => {
    // Given the wiring this repository ships
    // When
    const missing = STATIC_SUITE_COVERAGE.flatMap((coverage) =>
      coverage.files.filter((file) => !existsSync(join(repoRoot, file))),
    );

    // Then
    expect(STATIC_SUITE_COVERAGE).toHaveLength(4);
    expect(missing).toEqual([]);
  });

  it.skipIf(!aiDocsPresent(repoRoot))(
    'should answer every coverage SPEC 21 states and invent none',
    () => {
      // Given the real documents and the real repository, which is what the gate runs on
      const spec = readFileSync(join(repoRoot, SPEC_FILE), 'utf8');

      // When
      const issues = checkStaticCoverage(STATIC_SUITE_COVERAGE, {
        specNames: suiteRowOf(spec, STATIC_SUITE_ROW),
        exists: (path) => existsSync(join(repoRoot, path)),
        casesIn: (path) => caseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
        assertionlessIn: (path) =>
          assertionlessCaseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
      });

      // Then
      expect(suiteRowOf(spec, STATIC_SUITE_ROW)).toHaveLength(4);
      expect(issues).toEqual([]);
    },
  );

  it('should name a suite file that is there for every clause of the milestone', () => {
    // Given the clause wiring this repository ships
    // When
    const missing = MILESTONE_CLAUSE_COVERAGE.flatMap((clause) =>
      clause.files.filter((file) => !existsSync(join(repoRoot, file))),
    );

    // Then
    expect(MILESTONE_CLAUSE_COVERAGE).toHaveLength(3);
    expect(missing).toEqual([]);
  });

  it.skipIf(!aiDocsPresent(repoRoot))(
    'should answer every clause the M3 definition of done states and invent none',
    () => {
      // Given the real documents and the real repository, which is what the gate runs on. Until
      // T042 one clause of the three had a case naming it and the other two had none.
      const spec = readFileSync(join(repoRoot, SPEC_FILE), 'utf8');

      // When
      const issues = checkMilestoneClauses(MILESTONE_CLAUSE_COVERAGE, {
        milestone: MILESTONE_UNDER_GATE,
        clauses: milestoneClausesOf(spec, MILESTONE_UNDER_GATE),
        specNames: [],
        exists: (path) => existsSync(join(repoRoot, path)),
        casesIn: (path) => caseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
        assertionlessIn: (path) =>
          assertionlessCaseTitlesIn(readFileSync(join(repoRoot, path), 'utf8')),
      });

      // Then
      expect(milestoneClausesOf(spec, MILESTONE_UNDER_GATE)).toHaveLength(3);
      expect(issues).toEqual([]);
    },
  );

  it('should find the committed CI job pinning a runner and declaring its size', () => {
    // Given the workflow this repository ships
    const workflow = readFileSync(join(repoRoot, STATIC_BUDGET_JOB.workflow), 'utf8');

    // When
    const issues = checkBudgetJob(workflow, STATIC_BUDGET_JOB);

    // Then
    expect(issues).toEqual([]);
  });

  it('should run after the claims gate and before coverage', () => {
    // Given, both of them ask whether a table of the specification has a runner, and this one
    // starts a child process, so it goes late
    const order = GATES.map((gate) => gate.id);

    // When
    const position = order.indexOf(staticSuitesGate.id);

    // Then
    expect(order[position - 1]).toBe('claims');
    // The federation row gate joined at T047, between this one and coverage, and it is named here
    // rather than the assertion loosened to "somewhere before coverage": what this case is about is
    // the arrangement, so a gate arriving between the two is a decision to write down.
    expect(order[position + 1]).toBe('federation-suites');
    // `T054` added two more, and the arrangement is written down rather than loosened for the
    // reason the paragraph above gives: the row gates run together, newest last, and `coverage`
    // stays the end of the run because it runs the whole suite a second time under instrumentation.
    expect(order[position + 2]).toBe('events-suites');
    // `T059` added the fourth row gate, and it is named here for the same reason: four SPEC 21 rows
    // close M6, so the family grew by one rather than the arrangement being left to chance.
    expect(order[position + 3]).toBe('m6-suites');
    expect(order[position + 4]).toBe('reader-pages');
    expect(order.indexOf('coverage')).toBe(position + 5);
    expect(order.indexOf('coverage')).toBe(order.length - 1);
  });
});
