import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILD_FILE, CLAIM_MAP_FILE, SPEC_20_BUDGET_IDS, SPEC_FILE } from '../../src/config';
import { planTaskIds } from '../../src/lib/build-manifest';
import {
  checkClaimMap,
  parseBudgetRows,
  parseClaimMap,
  parseSecurityClaims,
  type ClaimCheckInput,
  type ClaimMapRow,
} from '../../src/lib/claims';

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');

const CLAIMS = [
  { id: '19.1', text: 'sanitization' },
  { id: '19.2', text: 'strict csp' },
];

/** A check over two claims and two budgets, with every file said to exist unless named. */
function check(map: readonly ClaimMapRow[], missing: readonly string[] = []): ClaimCheckInput {
  return {
    securityClaims: CLAIMS,
    budgetIds: ['client-js', 'tti'],
    budgetRows: ['Клиентский JS', 'TTI'],
    map,
    taskIds: ['T029', 'T039', 'TX-VIS'],
    exists: (path) => !missing.includes(path),
  };
}

const proved = (id: string, proofs: string[] = ['test/a.spec.ts']): ClaimMapRow => ({
  id,
  proofs,
  status: 'proved',
});

const scheduled = (id: string, status: string): ClaimMapRow => ({ id, proofs: [], status });

describe('parseSecurityClaims', () => {
  it('should read the ten claims out of the specification itself', () => {
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
  it('should read every row of the SPEC 20 table and stop at the prose under it', () => {
    // Given the real document, whose budget table is followed by several pages about fonts
    const spec = readFileSync(join(repoRoot, SPEC_FILE), 'utf8');

    // When
    const rows = parseBudgetRows(spec);

    // Then
    expect(rows).toHaveLength(SPEC_20_BUDGET_IDS.length);
    expect(rows.some((row) => row.includes('TTI'))).toBe(true);
  });
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
      { id: '19.2', proofs: ['test/a.spec.ts'], status: 'T029' },
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
      budgetRows: ['Клиентский JS', 'TTI', 'Something new'],
    };

    // When
    const issues = checkClaimMap(input);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['budget-count']);
  });
});

describe('the committed claim map', () => {
  it('should answer every claim the specification makes, against files that are there', () => {
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
  });
});
