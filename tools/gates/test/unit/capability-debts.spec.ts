import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CAPABILITY_DEBTS } from '../../src/config';
import { capabilityDebtsGate } from '../../src/gates/capability-debts.gate';
import type { GateResult } from '../../src/types';
import {
  checkCapabilityDebts,
  describeCapabilityDebt,
  type CapabilityDebt,
  type CapabilityDebtContext,
} from '../../src/lib/capability-debts';
import type { BuildMilestone } from '../../src/lib/build-manifest';

/**
 * The list of unreachable capabilities, and the two ways it stops meaning anything.
 *
 * IT HAS TO FAIL IN BOTH DIRECTIONS OR IT IS A COMMENT. An entry that outlives its milestone and
 * an entry whose capability is now reachable are both failures, and the second is the one a
 * reader would never think to look for: the wiring lands, the entry stays, and from then on the
 * list describes a repository that no longer exists.
 */

/**
 * A milestone with one task, ticked or not, which is what expiry is judged against.
 *
 * @param id - Milestone id
 * @param done - Whether its only task is ticked
 * @returns The milestone
 */
function milestone(id: string, done: boolean): BuildMilestone {
  return {
    id,
    label: `${id} - PLANTED`,
    tasks: [{ id: 'T001', done, startLine: 1, endLine: 2, title: 'planted' }],
  };
}

const SOUND: CapabilityDebt = {
  id: 'proxy-selection',
  capability: 'the proxy is mounted and the page cannot select it',
  owners: ['T033'],
  reachableBy: 'M2',
  recordedAt: '2026-08-13',
  diagnosis: 'measured on the built artefact',
  roots: ['packages/nest/dist/browser'],
  marker: 'proxyPath',
};

/**
 * A context in which the entry above is sound, so each case changes exactly one thing.
 *
 * @param overrides - What this case changes
 * @returns The context
 */
function context(overrides: Partial<CapabilityDebtContext> = {}): CapabilityDebtContext {
  return {
    taskIds: ['T033', 'T034'],
    milestones: [milestone('M2', false)],
    markerFound: new Map([['proxy-selection', false]]),
    ...overrides,
  };
}

describe('checkCapabilityDebts', () => {
  it('should accept an entry whose owner exists, whose milestone is open and whose marker is absent', () => {
    // Given
    const debts = [SOUND];

    // When
    const issues = checkCapabilityDebts(debts, context());

    // Then
    expect(issues).toEqual([]);
  });

  it('should fail when every task of the milestone it had to be reachable by is ticked', () => {
    // Given
    const debts = [SOUND];

    // When
    const issues = checkCapabilityDebts(debts, context({ milestones: [milestone('M2', true)] }));

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['milestone-closed']);
    expect(issues[0]?.message).toContain('The milestone is not done');
  });

  it('should fail as stale when the marker the entry names is in the built bundle', () => {
    // Given
    const debts = [SOUND];

    // When
    const issues = checkCapabilityDebts(
      debts,
      context({ markerFound: new Map([['proxy-selection', true]]) }),
    );

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['stale']);
    expect(issues[0]?.message).toContain('proxyPath');
  });

  it('should fail when nothing looked for the marker, rather than reading silence as still unreachable', () => {
    // Given
    const debts = [SOUND];

    // When
    const issues = checkCapabilityDebts(debts, context({ markerFound: new Map() }));

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['unchecked']);
  });

  it('should fail on an owner that is not a task the plan carries', () => {
    // Given
    const debts = [{ ...SOUND, owners: ['T999'] }];

    // When
    const issues = checkCapabilityDebts(debts, context());

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['unknown-owner']);
  });

  it('should fail on an entry that names no owner at all', () => {
    // Given
    const debts = [{ ...SOUND, owners: [] }];

    // When
    const issues = checkCapabilityDebts(debts, context());

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['no-owner']);
  });

  it('should fail on a milestone BUILD.md does not have, because such an entry has no expiry', () => {
    // Given
    const debts = [{ ...SOUND, reachableBy: 'M9' }];

    // When
    const issues = checkCapabilityDebts(debts, context());

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['unknown-milestone']);
  });

  it('should fail on an entry with no marker and no roots, because it could never expire', () => {
    // Given
    const debts = [{ ...SOUND, marker: '', roots: [] }];

    // When
    const issues = checkCapabilityDebts(debts, {
      ...context(),
      markerFound: new Map([['proxy-selection', false]]),
    });

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['incomplete', 'no-roots']);
  });

  it('should fail on two entries with the same id, because which terms apply would be a guess', () => {
    // Given
    const debts = [SOUND, SOUND];

    // When
    const issues = checkCapabilityDebts(debts, context());

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['duplicate']);
  });
});

/** Where a synthetic tree is built, replaced per test. */
let root: string | undefined;

/**
 * Builds a tree with a BUILD.md the gate can read and a browser bundle it can scan.
 *
 * THE PLAN IS SYNTHETIC AND THE ENTRY IS THE COMMITTED ONE, which is the arrangement that makes
 * these cases about the gate rather than about today's repository. Every milestone and owner a
 * committed entry names has to exist in the planted CONTENTS, so the cases below write M2 and
 * M3, one task each, and tick M2's or not: M2 closing is what the expiry cases exercise, and
 * M3 stays open so the entries it holds read as scheduled rather than stale.
 *
 * @param options - Whether the milestone is closed, and what the built bundle contains
 * @returns Absolute path of the tree root
 */
function plant(options: { readonly closed: boolean; readonly bundle: string }): string {
  root = mkdtempSync(join(tmpdir(), 'openref-capability-'));
  const box = options.closed ? 'x' : ' ';

  mkdirSync(join(root, 'ai-docs'), { recursive: true });
  writeFileSync(
    join(root, 'ai-docs', 'BUILD.md'),
    [
      '## CONTENTS',
      '',
      '**M2 - RUNNER AND L2 THEMES**',
      '',
      `- [${box}] \`T033\`  L0900-L0920  Distribution builds and DOM modes`,
      '',
      '**M3 - CLI AND CI**',
      '',
      `- [${box}] \`T039\`  L1024-L1047  Static build`,
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(join(root, 'ai-docs', 'BUILD-AMENDMENTS.md'), '', 'utf8');

  const browser = join(root, 'packages', 'nest', 'dist', 'browser');
  mkdirSync(browser, { recursive: true });
  writeFileSync(join(browser, 'openref.js'), options.bundle, 'utf8');

  return root;
}

/**
 * Every error message the gate produced, joined for matching.
 *
 * @param result - What the gate returned
 * @returns The error findings as one string
 */
function errorsOf(result: GateResult): string {
  return result.findings
    .filter((finding) => finding.level === 'error')
    .map((finding) => finding.message)
    .join('\n');
}

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe('capabilityDebtsGate', () => {
  it('should pass while the milestone is open and the capability is still unreachable', async () => {
    // Given
    const repoRoot = plant({ closed: false, bundle: 'const a=1;export{a};' });

    // When
    const result = await capabilityDebtsGate.run({ repoRoot });

    // Then
    expect(result.status).toBe('pass');
    expect(result.findings.some((finding) => finding.message.startsWith('UNREACHABLE'))).toBe(true);
  });

  it('should fail the moment the last task of the milestone is ticked with the entry still here', async () => {
    // Given
    const repoRoot = plant({ closed: true, bundle: 'const a=1;export{a};' });

    // When
    const result = await capabilityDebtsGate.run({ repoRoot });

    // Then
    expect(result.status).toBe('fail');
    expect(errorsOf(result)).toContain('milestone-closed');
  });

  it('should fail as stale once the marker appears in the built bundle', async () => {
    // Given
    const repoRoot = plant({
      closed: false,
      bundle: 'const i=await fetch(base+"/_search-index");export{i};',
    });

    // When
    const result = await capabilityDebtsGate.run({ repoRoot });

    // Then
    expect(result.status).toBe('fail');
    expect(errorsOf(result)).toContain('stale');
  });

  it('should error rather than skip when nothing is built, because an unread bundle is not a pass', async () => {
    // Given
    const repoRoot = plant({ closed: false, bundle: 'const a=1;export{a};' });
    rmSync(join(repoRoot, 'packages'), { recursive: true, force: true });

    // When
    const result = await capabilityDebtsGate.run({ repoRoot });

    // Then
    expect(result.status).toBe('fail');
    expect(errorsOf(result)).toContain('Run pnpm build');
  });

  it('should still fail on a stale entry where ai-docs is absent, and skip only the plan half', async () => {
    // Given
    const repoRoot = plant({
      closed: false,
      bundle: 'const i=await fetch(base+"/_search-index");export{i};',
    });
    rmSync(join(repoRoot, 'ai-docs'), { recursive: true, force: true });

    // When
    const result = await capabilityDebtsGate.run({ repoRoot });

    // Then
    expect(result.status).toBe('fail');
    expect(errorsOf(result)).toContain('stale');
  });

  it('should skip with a named reason where ai-docs is absent and the entry is still sound', async () => {
    // Given
    const repoRoot = plant({ closed: false, bundle: 'const a=1;export{a};' });
    rmSync(join(repoRoot, 'ai-docs'), { recursive: true, force: true });

    // When
    const result = await capabilityDebtsGate.run({ repoRoot });

    // Then
    expect(result.status).toBe('skip');
    expect(result.skipReason).toBe('ai-docs-absent');
  });
});

describe('the committed list', () => {
  it('should name a marker that is a fact the page reads rather than the class it would build', () => {
    // Given
    const search = CAPABILITY_DEBTS.find((entry) => entry.id === 'full-text-search');

    // When
    const marker = search?.marker ?? '';

    // Then
    // ISearchPort and buildSearchIndex are in shipped artefacts today and prove nothing,
    // because a declaration ships whether or not anything selects it. The entry has to name
    // something that is absent until the choice exists, which is the URL segment the page
    // constructs when the palette first requests the index.
    expect(marker).not.toBe('ISearchPort');
    expect(marker).not.toBe('buildSearchIndex');
    expect(marker.length).toBeGreaterThan(0);
  });

  it('should describe every entry with its owner and the milestone it must be reachable by', () => {
    // Given
    const entries = CAPABILITY_DEBTS;

    // When
    const lines = entries.map(describeCapabilityDebt);

    // Then
    for (const [index, line] of lines.entries()) {
      const entry = entries[index];
      expect(line).toContain(entry?.id ?? '');
      expect(line).toContain(`must be reachable by ${entry?.reachableBy ?? ''}`);
    }
  });
});
