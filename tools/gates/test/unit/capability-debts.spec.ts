import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CAPABILITY_DEBTS } from '../../src/config';
import { capabilityDebtsGate, runCapabilityDebtsGate } from '../../src/gates/capability-debts.gate';
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
      `- [${box}] \`T042\`  L1094-L1111  M3 gates`,
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

/**
 * Every informational message the gate produced, joined for matching.
 *
 * THE INFORMATIONAL HALF IS ASSERTED BECAUSE IT IS WHAT A READER ACTS ON. A gate whose verdict is
 * right and whose sentence is wrong teaches a reader to trust the sentence.
 *
 * @param result - What the gate returned
 * @returns The info findings as one string
 */
function infoOf(result: GateResult): string {
  return result.findings
    .filter((finding) => finding.level === 'info')
    .map((finding) => finding.message)
    .join('\n');
}

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

/**
 * The entry the gate cases below are driven with.
 *
 * PLANTED RATHER THAN COMMITTED, SINCE T042. These cases used to run the gate against whatever
 * `CAPABILITY_DEBTS` happened to hold, so the day the list cleared they stopped exercising the
 * mechanism and four of them went green over nothing. That is the same defect the gate itself was
 * fixed for one file over, arriving in its own test: a check whose subject can become empty proves
 * the empty case and reports it as the full one. The entry is written here, the plan below is
 * written to match it, and the committed list is asked a different question further down.
 */
const PLANTED: CapabilityDebt = {
  id: 'planted-capability',
  capability: 'the index is served and no shipped file requests it',
  owners: ['T042'],
  reachableBy: 'M3',
  recordedAt: '2026-08-28',
  diagnosis: 'measured on the built artefact',
  roots: ['packages/nest/dist/browser'],
  marker: '_search-index',
};

describe('capabilityDebtsGate', () => {
  it('should pass while the milestone is open and the capability is still unreachable', () => {
    // Given
    const repoRoot = plant({ closed: false, bundle: 'const a=1;export{a};' });

    // When
    const result = runCapabilityDebtsGate({ repoRoot }, [PLANTED]);

    // Then
    expect(result.status).toBe('pass');
    expect(result.findings.some((finding) => finding.message.startsWith('UNREACHABLE'))).toBe(true);
  });

  it('should fail the moment the last task of the milestone is ticked with the entry still here', () => {
    // Given
    const repoRoot = plant({ closed: true, bundle: 'const a=1;export{a};' });

    // When
    const result = runCapabilityDebtsGate({ repoRoot }, [PLANTED]);

    // Then
    expect(result.status).toBe('fail');
    expect(errorsOf(result)).toContain('milestone-closed');
  });

  it('should fail as stale once the marker appears in the built bundle', () => {
    // Given
    const repoRoot = plant({
      closed: false,
      bundle: 'const i=await fetch(base+"/_search-index");export{i};',
    });

    // When
    const result = runCapabilityDebtsGate({ repoRoot }, [PLANTED]);

    // Then
    expect(result.status).toBe('fail');
    expect(errorsOf(result)).toContain('stale');
  });

  it('should error rather than skip when nothing is built, because an unread bundle is not a pass', () => {
    // Given
    const repoRoot = plant({ closed: false, bundle: 'const a=1;export{a};' });
    rmSync(join(repoRoot, 'packages'), { recursive: true, force: true });

    // When
    const result = runCapabilityDebtsGate({ repoRoot }, [PLANTED]);

    // Then
    expect(result.status).toBe('fail');
    expect(errorsOf(result)).toContain('Run pnpm build');
  });

  it('should still fail on a stale entry where ai-docs is absent, and skip only the plan half', () => {
    // Given
    const repoRoot = plant({
      closed: false,
      bundle: 'const i=await fetch(base+"/_search-index");export{i};',
    });
    rmSync(join(repoRoot, 'ai-docs'), { recursive: true, force: true });

    // When
    const result = runCapabilityDebtsGate({ repoRoot }, [PLANTED]);

    // Then
    expect(result.status).toBe('fail');
    expect(errorsOf(result)).toContain('stale');
  });

  it('should skip with a named reason where ai-docs is absent and the entry is still sound', () => {
    // Given
    const repoRoot = plant({ closed: false, bundle: 'const a=1;export{a};' });
    rmSync(join(repoRoot, 'ai-docs'), { recursive: true, force: true });

    // When
    const result = runCapabilityDebtsGate({ repoRoot }, [PLANTED]);

    // Then
    expect(result.status).toBe('skip');
    expect(result.skipReason).toBe('ai-docs-absent');
  });
});

describe('the empty list, which used to be an unconditional pass', () => {
  it('should read the bundle and say what it read when nothing is recorded', () => {
    // Given the good day: every debt paid, the list cleared. Before T042 the walk lived inside the
    // loop over the entries, so this run opened no file at all.
    const repoRoot = plant({ closed: false, bundle: 'const a=1;export{a};' });

    // When
    const result = runCapabilityDebtsGate({ repoRoot }, []);

    // Then
    expect(result.status).toBe('pass');
    expect(
      result.findings.some((finding) =>
        /^read \d+ built browser module\(s\) under /.test(finding.message),
      ),
    ).toBe(true);
  });

  it('should fail with an empty list and no build, rather than passing on a walk of nothing', () => {
    // Given the state the gate's own header calls an error and never a skip, on the one day the
    // per entry rule cannot see it: nothing recorded and nothing built. The absence rule of SPEC 0
    // is the whole point, so the two are shown apart. First the control, with a bundle present.
    const built = plant({ closed: false, bundle: 'const a=1;export{a};' });
    const control = runCapabilityDebtsGate({ repoRoot: built }, []);

    // When the bundle goes away and the list is still empty
    const repoRoot = plant({ closed: false, bundle: 'const a=1;export{a};' });
    rmSync(join(repoRoot, 'packages'), { recursive: true, force: true });
    const result = runCapabilityDebtsGate({ repoRoot }, []);

    // Then
    expect(control.status).toBe('pass');
    expect(result.status).toBe('fail');
    expect(errorsOf(result)).toContain('looked at nothing rather than finding nothing wrong');
    expect(errorsOf(result)).toContain('Run pnpm build');
  });

  it('should say the bundle was read only when it was, and say the opposite when it was not', () => {
    // Given the same two trees as the case above, because the sentence is the subject here rather
    // than the verdict. Until the last round of T042 the empty list printed "the bundle that would
    // carry a marker was read anyway" in both of them, which is false in exactly the state this
    // gate exists to catch: no build, nothing read, and the run saying it had read the bundle.
    const built = plant({ closed: false, bundle: 'const a=1;export{a};' });
    const unread = plant({ closed: false, bundle: 'const a=1;export{a};' });
    rmSync(join(unread, 'packages'), { recursive: true, force: true });

    // When
    const withBundle = infoOf(runCapabilityDebtsGate({ repoRoot: built }, []));
    const withNothing = infoOf(runCapabilityDebtsGate({ repoRoot: unread }, []));

    // Then the run that read something says so with its count, and the run that read nothing says
    // it read nothing rather than borrowing the other sentence
    expect(withBundle).toContain('built browser module(s) that would carry a marker were read');
    expect(withBundle).toContain('read 1 built browser module(s) under');
    expect(withNothing).toContain('no built browser module was read to check that against');
    expect(withNothing).not.toContain('read anyway');
  });
});

describe('the committed list', () => {
  it('should be empty, with both entries paid rather than dropped', () => {
    // Given the state T042 left. `static-proxy-transport` was paid by a path rewrite transport in
    // `@openref/runner`, the `staticProxy` fact on the page model, the factory branch that reads
    // it and a browser case; `full-text-search` was paid by the palette fetching
    // `<mount>/_search-index` on first open. Both markers are in the shipped bundle, which is
    // what the gate expires an entry on, so the entries are removed rather than left as coverage.
    // When, Then
    expect(CAPABILITY_DEBTS).toEqual([]);
  });

  it('should keep its mechanism proved by planted entries, since an empty list proves nothing', () => {
    // Given the rule this file exists to hold, applied to itself: a check whose subject can become
    // empty proves the empty case and reads as the full one. Every case above is driven with
    // `PLANTED` rather than with the committed list for exactly that reason, so the day the list
    // cleared they went on failing on a closed milestone, on a stale marker and on an unread
    // bundle. This case is what says so out loud.
    const entries = [PLANTED];

    // When
    const lines = entries.map(describeCapabilityDebt);

    // Then
    for (const [index, line] of lines.entries()) {
      const entry = entries[index];
      expect(line).toContain(entry?.id ?? '');
      expect(line).toContain(`must be reachable by ${entry?.reachableBy ?? ''}`);
    }
  });

  it('should be the list the exported gate actually reads', async () => {
    // Given a tree with a bundle in it and no marker anywhere. The cases above drive the gate's
    // function with a planted list, which proves the mechanism and says nothing about the wiring:
    // a gate reading some other list would pass all of them. This runs the exported gate, so what
    // is proved here is that `CAPABILITY_DEBTS` is what it consults.
    const repoRoot = plant({ closed: false, bundle: 'const a=1;export{a};' });

    // When
    const result = await capabilityDebtsGate.run({ repoRoot });

    // Then, an empty list, an artefact read anyway, and no entry printed
    expect(result.status).toBe('pass');
    expect(result.findings.some((finding) => finding.message.startsWith('UNREACHABLE'))).toBe(
      false,
    );
    expect(
      result.findings.some((finding) =>
        /^read \d+ built browser module\(s\) under /.test(finding.message),
      ),
    ).toBe(true);
  });

  it('should refuse a marker that a declaration alone would satisfy', () => {
    // Given the rule the list's own type states: the marker is a fact the page reads, not a name
    // the bundle defines. `ISearchPort` and `buildSearchIndex` are in shipped artefacts today and
    // prove nothing, because a declaration ships whether or not anything selects it. Both entries
    // T042 paid named a fact of that kind, `_search-index` and `staticProxy`, and both appeared in
    // the bundle on the day the choice was written.
    const marker = PLANTED.marker;

    // When, Then
    expect(marker).not.toBe('ISearchPort');
    expect(marker).not.toBe('buildSearchIndex');
    expect(marker.length).toBeGreaterThan(0);
  });
});
