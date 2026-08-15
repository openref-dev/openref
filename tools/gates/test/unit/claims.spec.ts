import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILD_FILE, CLAIM_MAP_FILE, SPEC_20_BUDGET_IDS, SPEC_FILE } from '../../src/config';
import { aiDocsPresent } from '../../src/lib/ai-docs';
import { planTaskIds } from '../../src/lib/build-manifest';
import {
  checkClaimFigures,
  checkClaimMap,
  compareBudgetValues,
  parseBudgetRows,
  parseClaimMap,
  parseSecurityClaims,
  thresholdOfCell,
  type BudgetRow,
  type ClaimCheckInput,
  type ClaimMapRow,
  type ConfigThreshold,
} from '../../src/lib/claims';
import { configThresholds } from '../../src/gates/claims.gate';

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');

/**
 * Whether the real documents are on this machine.
 *
 * Three cases below parse `ai-docs/SPEC.md` itself, on the stated ground that a parse tested
 * only against a fixture proves nothing about the file it will run on. That ground is sound and
 * it is why they are bounded rather than rewritten: where the document is absent there is
 * nothing to prove anything about, and reading it there reported a private directory's absence
 * as a defect in the parser. The fixture cases beside them are unbounded and run everywhere.
 */
const HAVE_AI_DOCS = aiDocsPresent(repoRoot);

const CLAIMS = [
  { id: '19.1', text: 'sanitization' },
  { id: '19.2', text: 'strict csp' },
];

/** A check over two claims and two budgets, with every file said to exist unless named. */
function check(map: readonly ClaimMapRow[], missing: readonly string[] = []): ClaimCheckInput {
  return {
    securityClaims: CLAIMS,
    budgetIds: ['client-js', 'tti'],
    budgetRows: [
      { label: 'Клиентский JS', threshold: '≤ 100 КБ' },
      { label: 'TTI', threshold: 'записывается и печатается, порога нет' },
    ] as BudgetRow[],
    map,
    taskIds: ['T029', 'T039', 'TX-VIS'],
    exists: (path) => !missing.includes(path),
  };
}

const proved = (id: string, proofs: string[] = ['test/a.spec.ts']): ClaimMapRow => ({
  id,
  text: 'bounds',
  proofs,
  status: 'proved',
});

const scheduled = (id: string, status: string): ClaimMapRow => ({
  id,
  text: 'bounds',
  proofs: [],
  status,
});

describe('parseSecurityClaims', () => {
  it.skipIf(!HAVE_AI_DOCS)('should read the ten claims out of the specification itself', () => {
    // Given the real document, because a parse tested only against a fixture proves nothing
    // about the file it will run on
    const spec = readFileSync(join(repoRoot, SPEC_FILE), 'utf8');

    // When
    const claims = parseSecurityClaims(spec);

    // Then
    expect(claims).toHaveLength(10);
    expect(claims[0]?.id).toBe('19.1');
    expect(claims[9]?.id).toBe('19.10');
    expect(claims[3]?.text).toContain('origin');
  });

  it('should refuse a document with no section 19, rather than reporting no claims', () => {
    // Given, since an empty claim list would make every row unnecessary and the gate silent
    // When
    // Then
    expect(() => parseSecurityClaims('## 1. Something\n\ntext\n')).toThrow(/section 19/);
  });
});

describe('parseBudgetRows', () => {
  it.skipIf(!HAVE_AI_DOCS)(
    'should read every row of the SPEC 20 table and stop at the prose under it',
    () => {
      // Given the real document, whose budget table is followed by several pages about fonts
      const spec = readFileSync(join(repoRoot, SPEC_FILE), 'utf8');

      // When
      const rows = parseBudgetRows(spec);

      // Then
      expect(rows).toHaveLength(SPEC_20_BUDGET_IDS.length);
      expect(rows.some((row) => row.label.includes('TTI'))).toBe(true);
    },
  );
});

describe('checkClaimMap', () => {
  it('should be silent when every claim is answered', () => {
    // Given
    const map = [proved('19.1'), proved('19.2'), proved('client-js'), proved('tti')];

    // When
    // Then
    expect(checkClaimMap(check(map))).toEqual([]);
  });

  it('should report a claim the specification makes and the map does not answer', () => {
    // Given a map that lost a row, which is what happens when SPEC 19 gains a promise
    const map = [proved('19.1'), proved('client-js'), proved('tti')];

    // When
    const issues = checkClaimMap(check(map));

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['claim-unanswered']);
    expect(issues[0]?.message).toContain('19.2');
  });

  it('should report a proof file that is not in the repository', () => {
    // Given a test that was renamed, which leaves the claim unproved and the map saying otherwise
    const map = [
      proved('19.1', ['test/gone.spec.ts']),
      proved('19.2'),
      proved('client-js'),
      proved('tti'),
    ];

    // When
    const issues = checkClaimMap(check(map, ['test/gone.spec.ts']));

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['proof-missing']);
  });

  it('should report a claim recorded as proved with no file behind it', () => {
    // Given, because that is precisely the assertion in a document T015 exists to replace
    const map = [proved('19.1', []), proved('19.2'), proved('client-js'), proved('tti')];

    // When
    const issues = checkClaimMap(check(map));

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['proved-without-proof']);
  });

  it('should report a claim owned by a task that does not exist', () => {
    // Given a plausible looking id that no plan carries
    const map = [proved('19.1'), scheduled('19.2', 'T099'), proved('client-js'), proved('tti')];

    // When
    const issues = checkClaimMap(check(map));

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['owner-unknown']);
  });

  it('should accept a task from the amendments as an owner', () => {
    // Given, since BUILD.md cannot gain a task without being regenerated
    const map = [proved('19.1'), scheduled('19.2', 'TX-VIS'), proved('client-js'), proved('tti')];

    // When
    // Then
    expect(checkClaimMap(check(map))).toEqual([]);
  });

  it('should report a scheduled claim that names a proof', () => {
    // Given, because either the file proves it, and then it is proved, or it does not belong
    const map = [
      proved('19.1'),
      { id: '19.2', text: 'bounds', proofs: ['test/a.spec.ts'], status: 'T029' },
      proved('client-js'),
      proved('tti'),
    ];

    // When
    const issues = checkClaimMap(check(map));

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['scheduled-with-proof']);
  });

  it('should report a row for a claim nobody makes', () => {
    // Given a claim that was removed from the specification and left answered here
    const map = [
      proved('19.1'),
      proved('19.2'),
      proved('client-js'),
      proved('tti'),
      proved('19.3'),
    ];

    // When
    const issues = checkClaimMap(check(map));

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['claim-unknown']);
  });

  it('should report a claim answered twice', () => {
    // Given
    const map = [
      proved('19.1'),
      proved('19.2'),
      proved('19.2'),
      proved('client-js'),
      proved('tti'),
    ];

    // When
    const issues = checkClaimMap(check(map));

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['claim-answered-twice']);
  });

  it('should accept a claim split into parts that cover it', () => {
    // Given a promise whose halves belong to different milestones
    const map = [
      proved('19.1'),
      proved('19.2a'),
      scheduled('19.2b', 'T039'),
      proved('client-js'),
      proved('tti'),
    ];

    // When
    // Then
    expect(checkClaimMap(check(map))).toEqual([]);
  });

  it('should report parts that do not run from a without a gap', () => {
    // Given, because a, c reads as full coverage while b was never written
    const map = [
      proved('19.1'),
      proved('19.2a'),
      proved('19.2c'),
      proved('client-js'),
      proved('tti'),
    ];

    // When
    const issues = checkClaimMap(check(map));

    // Then
    expect(issues.map((issue) => issue.rule)).toContain('claim-part-missing');
  });

  it('should report a claim answered both whole and in parts', () => {
    // Given
    const map = [
      proved('19.1'),
      proved('19.2'),
      proved('19.2a'),
      proved('client-js'),
      proved('tti'),
    ];

    // When
    const issues = checkClaimMap(check(map));

    // Then
    expect(issues.map((issue) => issue.rule)).toContain('claim-split-and-whole');
  });

  it('should report a budget the specification sets and the configuration does not know', () => {
    // Given the two lists disagreeing, which is a promise nothing measures or a check
    // protecting nothing
    const input = {
      ...check([proved('19.1'), proved('19.2'), proved('client-js'), proved('tti')]),
      budgetRows: [
        { label: 'Клиентский JS', threshold: '≤ 100 КБ' },
        { label: 'TTI', threshold: 'записывается и печатается, порога нет' },
        { label: 'Something new', threshold: '≤ 1 КБ' },
      ] as BudgetRow[],
    };

    // When
    const issues = checkClaimMap(input);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['budget-count']);
  });
});

describe('thresholdOfCell', () => {
  it('should read every cell form the table writes, leading segment only', () => {
    // Given, When, Then: the present tense is before the first comma, history after it
    expect(thresholdOfCell('≤ 100 КБ')).toEqual({ kind: 'bytes', value: 102_400 });
    expect(thresholdOfCell('≤ 22 300 байт')).toEqual({ kind: 'bytes', value: 22_300 });
    expect(thresholdOfCell('≤ 61 КБ, был 56 до TX-SHAPES: пересчитан')).toEqual({
      kind: 'bytes',
      value: 62_464,
    });
    expect(thresholdOfCell('≤ 250 МБ')).toEqual({ kind: 'bytes', value: 262_144_000 });
    expect(thresholdOfCell('≤ 2 с (один раз на хеш)')).toEqual({ kind: 'seconds', value: 2 });
    expect(thresholdOfCell('≤ 2 (медиана 25 навигаций)')).toEqual({ kind: 'count', value: 2 });
    expect(thresholdOfCell('0')).toEqual({ kind: 'count', value: 0 });
    expect(thresholdOfCell('записывается и печатается, порога нет')).toEqual({ kind: 'report' });
    expect(thresholdOfCell('250 KB')).toEqual({ kind: 'bytes', value: 256_000 });
    expect(thresholdOfCell('2, as a median of 25 navigations')).toEqual({
      kind: 'count',
      value: 2,
    });
  });
});

describe('compareBudgetValues, planted with the drift T031 found', () => {
  /**
   * The plant the T034 amendment demands: the four numbers TX-SLOTWIRE moved in the
   * configuration while SPEC 20 kept the old ones. The first version of this check has to
   * name all of them against the configuration of that day.
   */
  const CONFIG_OF_THAT_DAY: ConfigThreshold[] = [
    { id: 'client-js-raw', threshold: { kind: 'bytes', value: 103 * 1024 } },
    { id: 'client-js-palette', threshold: { kind: 'bytes', value: 2_200 } },
    { id: 'client-js-palette-raw', threshold: { kind: 'bytes', value: 4_900 } },
    { id: 'client-js-schema-raw', threshold: { kind: 'bytes', value: 4_700 } },
  ];

  const STALE_TABLE: BudgetRow[] = [
    { label: 'Клиентский JS, сырые байты', threshold: '≤ 98 КБ' },
    { label: 'Палитра, gzip', threshold: '≤ 1 900 байт' },
    { label: 'Палитра, сырые байты', threshold: '≤ 3 900 байт' },
    { label: 'Схема, сырые байты', threshold: '≤ 4 200 байт' },
  ];

  it('should name all four table numbers that drifted, stale and missing both ways', () => {
    // When the checker of today reads the table of that day
    const issues = compareBudgetValues(STALE_TABLE, CONFIG_OF_THAT_DAY);

    // Then every stale value is named as stale and every enforced value as unstated:
    // eight findings over four rows, the two directions of one drift
    expect(issues.filter((issue) => issue.rule === 'budget-value-stale')).toHaveLength(4);
    expect(issues.filter((issue) => issue.rule === 'budget-value-missing')).toHaveLength(4);
    expect(issues.map((issue) => issue.message).join('\n')).toContain('98 KB');
    expect(issues.map((issue) => issue.message).join('\n')).toContain('1,900 bytes');
  });

  it('should be silent when both files state the same values, whatever the order', () => {
    // Given the same values in a different row order, since the table owns its order
    const table: BudgetRow[] = [
      { label: 'Схема, сырые байты', threshold: '≤ 4 700 байт' },
      { label: 'Клиентский JS, сырые байты', threshold: '≤ 103 КБ' },
      { label: 'Палитра, сырые байты', threshold: '≤ 4 900 байт' },
      { label: 'Палитра, gzip', threshold: '≤ 2 200 байт' },
    ];

    // When, Then: a commit that moves a cap in both files together is green
    expect(compareBudgetValues(table, CONFIG_OF_THAT_DAY)).toEqual([]);
  });
});

describe('checkClaimFigures, planted with the send pair T031 found in the map', () => {
  it('should name a map row whose figure is not the one the gate holds', () => {
    // Given the two rows that had been wrong since T027, against the configuration of that day
    const config: ConfigThreshold[] = [
      { id: 'client-js-send', threshold: { kind: 'bytes', value: 22_300 } },
      { id: 'client-js-send-raw', threshold: { kind: 'bytes', value: 65_900 } },
    ];
    const map: ClaimMapRow[] = [
      {
        id: 'client-js-send',
        text: 'What a press on Send downloads, gzip, 18,700 bytes',
        proofs: ['test/a.spec.ts'],
        status: 'proved',
      },
      {
        id: 'client-js-send-raw',
        text: 'The same chunks, raw, 53,600 bytes',
        proofs: ['test/a.spec.ts'],
        status: 'proved',
      },
    ];

    // When
    const issues = checkClaimFigures(map, config);

    // Then both are named
    expect(issues.map((issue) => issue.rule)).toEqual(['claim-figure-stale', 'claim-figure-stale']);
  });

  it('should accept a row that states the enforced value in KB beside its history', () => {
    // Given a row whose prose carries an old figure and the current one
    const config: ConfigThreshold[] = [
      { id: 'theme-css-raw', threshold: { kind: 'bytes', value: 61 * 1024 } },
    ];
    const map: ClaimMapRow[] = [
      {
        id: 'theme-css-raw',
        text: 'Default theme CSS, raw, 61 KB since TX-SHAPES, was 56 KB',
        proofs: ['test/a.spec.ts'],
        status: 'proved',
      },
    ];

    // When, Then: history beside the current figure is not drift
    expect(checkClaimFigures(map, config)).toEqual([]);
  });
});

describe('the committed threshold agreement', () => {
  it.skipIf(!HAVE_AI_DOCS)(
    'should hold the table, the configuration and the map to the same values today',
    () => {
      // Given the real three files, which is the state every commit must keep: the home is
      // config.ts and the two references agree with it, per the T034 amendment
      const spec = readFileSync(join(repoRoot, SPEC_FILE), 'utf8');
      const map = readFileSync(join(repoRoot, CLAIM_MAP_FILE), 'utf8');
      const thresholds = configThresholds();

      // When
      const tableIssues = compareBudgetValues(parseBudgetRows(spec), thresholds);
      const mapIssues = checkClaimFigures(parseClaimMap(map), thresholds);

      // Then
      expect(tableIssues).toEqual([]);
      expect(mapIssues).toEqual([]);
    },
  );
});

describe('the committed claim map', () => {
  it.skipIf(!HAVE_AI_DOCS)(
    'should answer every claim the specification makes, against files that are there',
    () => {
      // Given the real documents and the real repository, which is what the gate runs on. THE
      // OWNER LIST IS READ RATHER THAN WRITTEN OUT: it used to be five ids typed here, and a
      // second copy of a list is a second thing to forget. The gate reads it from BUILD.md and the
      // amendments, so this reads it the same way, and a task filed there needs no edit here.
      const spec = readFileSync(join(repoRoot, SPEC_FILE), 'utf8');
      const map = readFileSync(join(repoRoot, CLAIM_MAP_FILE), 'utf8');

      // When
      const issues = checkClaimMap({
        securityClaims: parseSecurityClaims(spec),
        budgetIds: SPEC_20_BUDGET_IDS,
        budgetRows: parseBudgetRows(spec),
        map: parseClaimMap(map),
        taskIds: planTaskIds(
          readFileSync(join(repoRoot, BUILD_FILE), 'utf8'),
          readFileSync(join(repoRoot, 'ai-docs/BUILD-AMENDMENTS.md'), 'utf8'),
        ),
        exists: (path) => existsSync(join(repoRoot, path)),
      });

      // Then
      expect(issues).toEqual([]);
    },
  );
});
