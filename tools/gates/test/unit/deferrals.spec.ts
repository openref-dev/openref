import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFERRAL_DOCUMENTS } from '../../src/config';
import { POST_RELEASE_MILESTONE } from '../../src/lib/build-manifest';
import {
  checkDeferrals,
  checkMaterial,
  findMarkers,
  insideQuotes,
  type MilestoneState,
  type PostReleaseEntry,
} from '../../src/lib/deferrals';
import { deferralsGate, sourceRoots } from '../../src/gates/deferrals.gate';
import { buildManifestGate } from '../../src/gates/build-manifest.gate';
import { GATES } from '../../src/run';

/** The plan as it stood on the day this was written: M5 finished, RELEASE still open. */
const MILESTONES: readonly MilestoneState[] = [
  { id: 'M5', label: 'M5 - ASYNCAPI AND TOPOLOGY', closed: true },
  { id: 'RELEASE', label: 'RELEASE', closed: false },
];

const OPEN_ENTRY: PostReleaseEntry = { id: 'TX-EVENT-PAYLOAD-DIFF', done: false, line: 42 };

describe('findMarkers', () => {
  it('should read a deferral that names a milestone', () => {
    // Given
    const text = 'Response headers are compared (DEFER M5) and channels are not.';

    // When
    const markers = findMarkers('doc.md', text);

    // Then
    expect(markers).toHaveLength(1);
    expect(markers[0]?.kind).toBe('deferral');
    expect(markers[0]?.owner).toBe('M5');
    expect(markers[0]?.line).toBe(1);
  });

  it('should read the two provenance forms as arrival rather than debt', () => {
    // Given, both spellings the documents already use, one Russian and one English
    const text = ['### 8.3. Event collectors (с M5)', 'Headless layer (from M2)'].join('\n');

    // When
    const markers = findMarkers('doc.md', text);

    // Then
    expect(markers.map((marker) => marker.kind)).toEqual(['provenance', 'provenance']);
    expect(markers.map((marker) => marker.owner)).toEqual(['M5', 'M2']);
  });

  it('should refuse a bare parenthesised milestone, which is the form that carried', () => {
    // Given, SPEC 17.1's own sentence as it stood for ten tasks
    const text = 'Out of scope: channels (M5), webhooks and callback trees.';

    // When
    const markers = findMarkers('spec.md', text);

    // Then
    expect(markers).toHaveLength(1);
    expect(markers[0]?.kind).toBe('ambiguous');
    expect(markers[0]?.owner).toBe('');
  });

  it('should take a marker inside straight quotes for a quotation, so the record can name it', () => {
    // Given, the amendments quoting the marker they are about
    const text = 'the "(M5)" in the out of scope sentence stops naming a closed milestone';

    // When
    const markers = findMarkers('amendments.md', text);

    // Then
    expect(markers[0]?.kind).toBe('quotation');
  });

  it('should take a marker after an opening guillemet for a quotation, closer or not', () => {
    // Given, BUILD-AMENDMENTS L9150, whose quoted sentence closes on the line below. Requiring
    // the closing guillemet on the same line was the first rule and it missed exactly this.
    const text = ['The sentence is: «Out of scope are channels (M5),', 'webhooks and more.»'].join(
      '\n',
    );

    // When
    const markers = findMarkers('amendments.md', text);

    // Then
    expect(markers).toHaveLength(1);
    expect(markers[0]?.kind).toBe('quotation');
  });

  it('should find a marker that wraps across a line break, which a line by line sweep missed', () => {
    // Given, the marker as it was first written into SPEC 17.1: the comma ended the line. The
    // line by line version of this function found nothing and the gate was green with the
    // marker sitting there unread, which is this file's own defect one level down.
    const text = [
      'work is re-filed (DEFER POST-1.0,',
      '  `TX-EVENT-PAYLOAD-DIFF`). Until then',
    ].join('\n');

    // When
    const markers = findMarkers('spec.md', text);

    // Then
    expect(markers).toHaveLength(1);
    expect(markers[0]?.kind).toBe('deferral');
    expect(markers[0]?.owner).toBe(POST_RELEASE_MILESTONE);
    expect(markers[0]?.entry).toBe('TX-EVENT-PAYLOAD-DIFF');
    expect(markers[0]?.line).toBe(1);
  });

  it('should report the line a marker starts on, so a message can send a reader to it', () => {
    // Given
    const text = ['first', 'second', 'third (DEFER RELEASE)'].join('\n');

    // When
    const markers = findMarkers('doc.md', text);

    // Then
    expect(markers[0]?.line).toBe(3);
  });
});

describe('insideQuotes', () => {
  it('should count an unmatched straight quote before the offset as an opening one', () => {
    // Given
    const line = 'says "(M5)" here';

    // When, the marker starts at the parenthesis
    const quoted = insideQuotes(line, line.indexOf('('));

    // Then
    expect(quoted).toBe(true);
  });

  it('should not call a marker quoted when the quotes before it are closed', () => {
    // Given
    const line = 'the "old" marker (M5) is still here';

    // When
    const quoted = insideQuotes(line, line.indexOf('(M5)'));

    // Then
    expect(quoted).toBe(false);
  });
});

describe('checkDeferrals', () => {
  it('should fail a deferral whose milestone has closed, which is the planted expiry', () => {
    // Given, the exact sentence SPEC 17.1 carried, in the readable form, against a plan where
    // M5 is finished. This is the plant: the day the milestone closes, the marker goes red.
    const markers = findMarkers('ai-docs/SPEC.md', 'Out of scope: channels (DEFER M5).');

    // When
    const issues = checkDeferrals(markers, MILESTONES, []);

    // Then, the subject was present and it is the reason for the failure
    expect(markers).toHaveLength(1);
    expect(issues.map((issue) => issue.rule)).toEqual(['deferral-expired']);
    expect(issues[0]?.message).toContain('ai-docs/SPEC.md:1');
    expect(issues[0]?.message).toContain('M5 - ASYNCAPI AND TOPOLOGY');
  });

  it('should pass a deferral whose milestone is still open, which is the planted live one', () => {
    // Given, the same marker homed at the one milestone that still has an unticked task
    const markers = findMarkers('ai-docs/SPEC.md', 'Out of scope: channels (DEFER RELEASE).');

    // When
    const issues = checkDeferrals(markers, MILESTONES, []);

    // Then, and the first assertion is what makes the second one mean anything: the marker was
    // read, counted as a deferral and held to a milestone, and only then found to be in order
    expect(markers.map((marker) => marker.kind)).toEqual(['deferral']);
    expect(markers[0]?.owner).toBe('RELEASE');
    expect(issues).toEqual([]);
  });

  it('should fail a deferral naming a milestone the plan does not carry', () => {
    // Given
    const markers = findMarkers('doc.md', 'later (DEFER M9)');

    // When
    const issues = checkDeferrals(markers, MILESTONES, []);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['deferral-unknown-milestone']);
  });

  it('should fail provenance naming a milestone the plan does not carry', () => {
    // Given, since a thing cannot have arrived from a milestone that never existed
    const markers = findMarkers('doc.md', 'the layer (с M9)');

    // When
    const issues = checkDeferrals(markers, MILESTONES, []);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['deferral-unknown-milestone']);
  });

  it('should say nothing about a quoted marker, whatever milestone it names', () => {
    // Given, a closed milestone quoted inside the record of the defect it caused
    const markers = findMarkers('doc.md', 'it used to say "(DEFER M5)" and no longer does');

    // When
    const issues = checkDeferrals(markers, MILESTONES, []);

    // Then
    expect(markers[0]?.kind).toBe('quotation');
    expect(issues).toEqual([]);
  });

  it('should fail a post release deferral that names no entry, since nothing could expire it', () => {
    // Given
    const markers = findMarkers('doc.md', `later (DEFER ${POST_RELEASE_MILESTONE})`);

    // When
    const issues = checkDeferrals(markers, MILESTONES, []);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['deferral-unowned']);
  });

  it('should fail a post release deferral addressed to an entry the amendments do not carry', () => {
    // Given
    const markers = findMarkers('doc.md', `later (DEFER ${POST_RELEASE_MILESTONE}, TX-GHOST)`);

    // When
    const issues = checkDeferrals(markers, MILESTONES, [OPEN_ENTRY]);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual([
      'deferral-unowned',
      'post-release-entry-unreferenced',
    ]);
  });

  it('should fail a post release deferral whose entry has been ticked while the marker stands', () => {
    // Given, the shape the closed T065 section was in: the ruling closed and the work still
    // described in the specification as owed
    const markers = findMarkers(
      'doc.md',
      `later (DEFER ${POST_RELEASE_MILESTONE}, TX-EVENT-PAYLOAD-DIFF)`,
    );

    // When
    const issues = checkDeferrals(markers, MILESTONES, [{ ...OPEN_ENTRY, done: true }]);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['deferral-owner-closed']);
    expect(issues[0]?.message).toContain('L42');
  });

  it('should pass a post release deferral that names an open entry', () => {
    // Given
    const markers = findMarkers(
      'doc.md',
      `later (DEFER ${POST_RELEASE_MILESTONE}, \`TX-EVENT-PAYLOAD-DIFF\`)`,
    );

    // When
    const issues = checkDeferrals(markers, MILESTONES, [OPEN_ENTRY]);

    // Then
    expect(markers[0]?.entry).toBe('TX-EVENT-PAYLOAD-DIFF');
    expect(issues).toEqual([]);
  });

  it('should fail an open post release entry that no marker points at', () => {
    // Given, the reverse direction: an entry a reader of the specification cannot arrive at
    const issues = checkDeferrals([], MILESTONES, [OPEN_ENTRY]);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['post-release-entry-unreferenced']);
    expect(issues[0]?.message).toContain('TX-EVENT-PAYLOAD-DIFF');
  });

  it('should leave a closed post release entry alone, since its work is history', () => {
    // Given
    const issues = checkDeferrals([], MILESTONES, [{ ...OPEN_ENTRY, done: true }]);

    // Then
    expect(issues).toEqual([]);
  });

  it('should report every offender rather than stopping at the first', () => {
    // Given
    const markers = findMarkers('doc.md', 'one (DEFER M5), two (M5), three (DEFER M9)');

    // When
    const issues = checkDeferrals(markers, MILESTONES, []);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual([
      'deferral-expired',
      'deferral-ambiguous',
      'deferral-unknown-milestone',
    ]);
  });
});

describe('checkMaterial', () => {
  it('should fail a sweep that found nothing, because every rule is green over nothing', () => {
    // Given, SPEC 0's sixth class: a check with no material is indistinguishable from one that
    // works, and `checkDeferrals` returns an empty list over an empty list of markers
    expect(checkDeferrals([], MILESTONES, [])).toEqual([]);

    // When
    const issue = checkMaterial([]);

    // Then
    expect(issue?.rule).toBe('deferral-no-material');
  });

  it('should say nothing when the sweep had material', () => {
    // Given
    const markers = findMarkers('doc.md', 'the layer (с M5)');

    // When
    const issue = checkMaterial(markers);

    // Then
    expect(issue).toBeUndefined();
  });
});

describe('sourceRoots', () => {
  it('should read the projects from the disk rather than from a list', () => {
    // Given the repository this file sits in
    const roots = sourceRoots(join(import.meta.dirname, '..', '..', '..', '..'));

    // Then, every workspace is represented and this package's own source is among them
    expect(roots).toContain('tools/gates/src');
    expect(roots).toContain('packages/core/src');
    expect(roots.filter((root) => root.startsWith('examples/')).length).toBeGreaterThan(0);
    expect(roots.every((root) => root.endsWith('/src'))).toBe(true);
  });

  it('should leave test directories out, so a case proving the rule cannot break it', () => {
    // Given, this file names markers of every form and lives under `test/`
    const roots = sourceRoots(join(import.meta.dirname, '..', '..', '..', '..'));

    // Then
    expect(roots.some((root) => root.includes('/test'))).toBe(false);
  });
});

describe('deferralsGate', () => {
  it('should run immediately after the build manifest, the same question over the other register', () => {
    // Given
    const order = GATES.map((gate) => gate.id);

    // When
    const position = order.indexOf(deferralsGate.id);

    // Then
    expect(position).toBeGreaterThan(-1);
    expect(order[position - 1]).toBe(buildManifestGate.id);
  });

  it('should sweep the specification and the plan, not only the four required documents', () => {
    // Given, a deferral can be written anywhere scope is discussed, and the claim map and the
    // remediation notes both schedule work
    expect(DEFERRAL_DOCUMENTS).toContain('ai-docs/SPEC.md');
    expect(DEFERRAL_DOCUMENTS).toContain('ai-docs/CLAIM-MAP.md');
    expect(DEFERRAL_DOCUMENTS).toContain('ai-docs/REMEDIATION.md');
    expect(DEFERRAL_DOCUMENTS).toContain('ai-docs/PROJECT_STATE.md');
  });
});
