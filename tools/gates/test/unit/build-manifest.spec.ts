import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILD_FILE,
  BUILD_TASK_COUNT,
  REQUIRED_DOC_MIN_BYTES,
  REQUIRED_DOCS,
} from '../../src/config';
import { aiDocsPresent } from '../../src/lib/ai-docs';
import {
  checkAmendmentSections,
  checkBuildManifest,
  checkOwnedEntries,
  checkRequiredDocs,
  parseAmendmentSections,
  parseContents,
  parseMilestones,
  parseOwnedEntries,
  planTaskIds,
  splitLines,
} from '../../src/lib/build-manifest';

/**
 * Whether the real documents are on this machine.
 *
 * THE GATE SKIPS LOUDLY WITHOUT `ai-docs/` AND THESE TESTS DID NOT, which is how a suite that
 * had only ever run where the directory is passed for six sessions and went red the first time
 * it ran anywhere else. Every case below that reads a real document is bounded by this, and the
 * ones that build their own fixture text are not: those are the parse itself and they run
 * everywhere.
 *
 * This is the same function the gates call, so a test and the gate it covers can never disagree
 * about what present means. Where the directory is absent this file proves less, and vitest
 * prints the reduced count. CI documents that rather than enforcing it, and the skip accounting
 * in the runner is what CI can enforce without the directory.
 */
const HAVE_AI_DOCS = aiDocsPresent(join(import.meta.dirname, '..', '..', '..', '..'));

/**
 * A miniature BUILD.md with the same shape as the real one: a CONTENTS block whose
 * entries address task headings by absolute line number.
 */
function buildFixture(overrides: Readonly<Record<number, string>> = {}): string {
  const lines = [
    '# OPENREF - BUILD', // 1
    '', // 2
    '## CONTENTS', // 3
    '', // 4
    '- [x] `T001`  L0009-L0011  First task', // 5
    '- [ ] `T002`  L0013-L0015  Second task', // 6
    '', // 7
    '---', // 8
    '### T001 [x] First task', // 9
    '', // 10
    'Body of the first task.', // 11
    '', // 12
    '### T002 [ ] Second task', // 13
    '', // 14
    'Body of the second task.', // 15
  ];

  for (const [line, text] of Object.entries(overrides)) {
    lines[Number(line) - 1] = text;
  }

  return `${lines.join('\n')}\n`;
}

const FIXTURE_LINES = 15;
const FIXTURE_TASKS = 2;

describe('splitLines', () => {
  it('should count a trailing newline as terminating the last line, not starting a new one', () => {
    // Given
    const text = 'a\nb\n';

    // When
    const lines = splitLines(text);

    // Then
    expect(lines).toEqual(['a', 'b']);
  });

  it('should count a file with no trailing newline by its content', () => {
    // Given
    const text = 'a\nb';

    // When
    const lines = splitLines(text);

    // Then
    expect(lines).toEqual(['a', 'b']);
  });
});

describe('parseContents', () => {
  it('should read the id, box, range and title of every CONTENTS entry', () => {
    // Given
    const lines = splitLines(buildFixture());

    // When
    const entries = parseContents(lines);

    // Then
    expect(entries).toEqual([
      { id: 'T001', done: true, startLine: 9, endLine: 11, title: 'First task' },
      { id: 'T002', done: false, startLine: 13, endLine: 15, title: 'Second task' },
    ]);
  });
});

describe('checkBuildManifest', () => {
  it('should report nothing for an intact file', () => {
    // Given
    const text = buildFixture();

    // When
    const issues = checkBuildManifest(text, FIXTURE_LINES, FIXTURE_TASKS);

    // Then
    expect(issues).toEqual([]);
  });

  it('should report a line count that no longer matches the ranges', () => {
    // Given
    const text = `${buildFixture()}\n`;

    // When
    const issues = checkBuildManifest(text, FIXTURE_LINES, FIXTURE_TASKS);

    // Then
    expect(issues.map((issue) => issue.rule)).toContain('line-count');
  });

  it('should report a range pointing at the wrong task when a line is inserted above it', () => {
    // Given, one line inserted before the headings pushes both tasks down by one
    const shifted = buildFixture().replace('---\n### T001', '---\n\n### T001');

    // When
    const issues = checkBuildManifest(shifted, FIXTURE_LINES + 1, FIXTURE_TASKS);

    // Then
    expect(issues.map((issue) => issue.rule)).toContain('heading-missing');
  });

  it('should report a range that lands on the heading of a different task', () => {
    // Given
    const text = buildFixture({ 5: '- [x] `T001`  L0013-L0015  First task' });

    // When
    const issues = checkBuildManifest(text, FIXTURE_LINES, FIXTURE_TASKS);

    // Then
    expect(issues.map((issue) => issue.rule)).toContain('heading-mismatch');
  });

  it('should report a box ticked in CONTENTS but not on the heading', () => {
    // Given
    const text = buildFixture({ 6: '- [x] `T002`  L0013-L0015  Second task' });

    // When
    const issues = checkBuildManifest(text, FIXTURE_LINES, FIXTURE_TASKS);

    // Then
    expect(issues.map((issue) => issue.rule)).toContain('box-mismatch');
  });

  it('should report a title that drifted between CONTENTS and the heading', () => {
    // Given
    const text = buildFixture({ 13: '### T002 [ ] Second task, renamed' });

    // When
    const issues = checkBuildManifest(text, FIXTURE_LINES, FIXTURE_TASKS);

    // Then
    expect(issues.map((issue) => issue.rule)).toContain('title-mismatch');
  });

  it('should report a CONTENTS entry that stopped parsing', () => {
    // Given, a range rewritten without its zero padding no longer addresses anything
    const text = buildFixture({ 6: '- [ ] `T002`  L13-L15  Second task' });

    // When
    const issues = checkBuildManifest(text, FIXTURE_LINES, FIXTURE_TASKS);

    // Then
    expect(issues.map((issue) => issue.rule)).toContain('task-count');
  });

  it('should report a range that runs past the end of the file', () => {
    // Given
    const text = buildFixture({ 6: '- [ ] `T002`  L0013-L0099  Second task' });

    // When
    const issues = checkBuildManifest(text, FIXTURE_LINES, FIXTURE_TASKS);

    // Then
    expect(issues.map((issue) => issue.rule)).toContain('range-bounds');
  });

  it('should report two tasks whose ranges overlap', () => {
    // Given
    const text = buildFixture({ 5: '- [x] `T001`  L0009-L0013  First task' });

    // When
    const issues = checkBuildManifest(text, FIXTURE_LINES, FIXTURE_TASKS);

    // Then
    expect(issues.map((issue) => issue.rule)).toContain('range-order');
  });

  it('should report the same id listed twice', () => {
    // Given
    const text = buildFixture({ 6: '- [ ] `T001`  L0013-L0015  Second task' });

    // When
    const issues = checkBuildManifest(text, FIXTURE_LINES, FIXTURE_TASKS);

    // Then
    expect(issues.map((issue) => issue.rule)).toContain('duplicate-id');
  });
});

describe('checkRequiredDocs', () => {
  const docs = [
    { file: 'ai-docs/SPEC.md', purpose: 'the specification' },
    { file: 'ai-docs/BUILD.md', purpose: 'the execution order' },
  ];

  it('should accept a document that is present and has content', () => {
    // Given
    const sizeOf = (): number => 4096;

    // When
    const checked = checkRequiredDocs(docs, 200, sizeOf);

    // Then
    expect(checked.map((doc) => doc.presence)).toEqual(['ok', 'ok']);
  });

  it('should report a document that is not there', () => {
    // Given, a fresh clone has none of these: ai-docs is outside the repository.
    const sizeOf = (file: string): number | undefined =>
      file === 'ai-docs/SPEC.md' ? undefined : 4096;

    // When
    const checked = checkRequiredDocs(docs, 200, sizeOf);

    // Then
    expect(checked[0]?.presence).toBe('missing');
    expect(checked[1]?.presence).toBe('ok');
  });

  it('should treat a placeholder as absent, since it carries nothing', () => {
    // Given
    const sizeOf = (): number => 12;

    // When
    const checked = checkRequiredDocs(docs, 200, sizeOf);

    // Then
    expect(checked.map((doc) => doc.presence)).toEqual(['empty', 'empty']);
    expect(checked[0]?.bytes).toBe(12);
  });

  it('should keep the purpose of each document, so the failure says what is gone', () => {
    // Given
    const sizeOf = (): undefined => undefined;

    // When
    const checked = checkRequiredDocs(docs, 200, sizeOf);

    // Then
    expect(checked.map((doc) => doc.purpose)).toEqual(['the specification', 'the execution order']);
  });
});

describe('the documents this project is written against', () => {
  it.skipIf(!HAVE_AI_DOCS)('should all be present and hold content right now', () => {
    // Given, the same check the gate runs, against the real files.
    const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');

    // When
    const checked = checkRequiredDocs(REQUIRED_DOCS, REQUIRED_DOC_MIN_BYTES, (file) => {
      try {
        return statSync(join(repoRoot, file)).size;
      } catch {
        return undefined;
      }
    });

    // Then
    expect(checked.filter((doc) => doc.presence !== 'ok')).toEqual([]);
    expect(checked).toHaveLength(4);
  });
});

describe('parseMilestones', () => {
  it('should group the CONTENTS entries under the milestone above them', () => {
    // Given
    const lines = [
      '**M0 - REFERENCE**',
      '',
      '- [x] `T001`  L0171-L0196  Monorepo skeleton',
      '- [ ] `T002`  L0197-L0220  IR types',
      '',
      '**M1 - RUNTIME INTELLIGENCE**',
      '',
      '- [ ] `T017`  L0547-L0568  Collector contract',
    ];

    // When
    const milestones = parseMilestones(lines);

    // Then
    expect(milestones.map((milestone) => milestone.id)).toEqual(['M0', 'M1']);
    expect(milestones[0]?.label).toBe('M0 - REFERENCE');
    expect(milestones[0]?.tasks.map((task) => task.id)).toEqual(['T001', 'T002']);
    expect(milestones[0]?.tasks.map((task) => task.done)).toEqual([true, false]);
  });

  it('should drop a bold line that owns no task, so a task body cannot invent a milestone', () => {
    // Given, the task bodies further down BUILD.md hold bold lines of their own, and one of them
    // matching the heading shape would otherwise produce a milestone that closes the moment it
    // appears, because a milestone with no task has every task of it ticked.
    const lines = ['**M0 - REFERENCE**', '- [ ] `T001`  L0001-L0002  a task', '**RELEASE**'];

    // When
    const milestones = parseMilestones(lines);

    // Then
    expect(milestones.map((milestone) => milestone.id)).toEqual(['M0']);
  });

  it.skipIf(!HAVE_AI_DOCS)(
    'should read the real BUILD.md as eight milestones covering every task',
    () => {
      // Given
      const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');
      const lines = splitLines(readFileSync(join(repoRoot, BUILD_FILE), 'utf8'));

      // When
      const milestones = parseMilestones(lines);
      const tasks = milestones.flatMap((milestone) => milestone.tasks);

      // Then
      expect(milestones.map((milestone) => milestone.id)).toEqual([
        'M0',
        'M1',
        'M2',
        'M3',
        'M4',
        'M5',
        'M6',
        'M7',
        'RELEASE',
      ]);
      expect(tasks).toHaveLength(BUILD_TASK_COUNT);
      expect(milestones[0]?.tasks.map((task) => task.id)).toContain('T016');
    },
  );
});

/**
 * The one definition of what the plan can hand work to.
 *
 * IT WAS TWO DEFINITIONS UNTIL 2026-08-10, one in the claims gate and one in the budget
 * exceptions gate, and they disagreed: the exceptions gate accepted a retrofit as an owner and
 * the claims gate did not. So `T011-R` could excuse a budget and could not own a claim, and
 * nothing said the two gates were answering the same question differently.
 */
describe('planTaskIds', () => {
  const amendments = [
    '### [ ] `T015-R1` The budget names work done, not time elapsed',
    '### [x] `T012-R3` A retrofit that is already ticked is still an owner',
    '### [ ] `TX-VIS` The reference routes behind a guard',
    '### [ ] `T099` A heading with no retrofit suffix is not an amendment task',
    'A line naming `T015-R2` in prose is not a heading and declares nothing',
  ].join('\n');

  it('should carry every BUILD.md task and every amendment task', () => {
    // Given, both files that can hold an id
    // When
    const ids = planTaskIds(buildFixture(), amendments);

    // Then
    expect(ids).toContain('T001');
    expect(ids).toContain('T015-R1');
    expect(ids).toContain('T012-R3');
    expect(ids).toContain('TX-VIS');
  });

  it('should take an id from a heading and never from prose', () => {
    // Given, a mention is not a declaration. An id that counted because a sentence used it would
    // let a claim be owned by a task nobody ever filed.
    // When
    const ids = planTaskIds(buildFixture(), amendments);

    // Then
    expect(ids).not.toContain('T015-R2');
    expect(ids).not.toContain('T099');
  });

  it.skipIf(!HAVE_AI_DOCS)(
    'should give the two gates that call it the same answer for the real files',
    () => {
      // Given, the condition that made this one function: `T011-R` owns the live `tti` exception
      // and now also owns claims, and both readings have to come out the same
      const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');
      const build = readFileSync(join(repoRoot, BUILD_FILE), 'utf8');
      const amendmentsText = readFileSync(join(repoRoot, 'ai-docs/BUILD-AMENDMENTS.md'), 'utf8');

      // When
      const ids = planTaskIds(build, amendmentsText);

      // Then
      expect(ids).toContain('T011-R');
      expect(ids).toContain('T015-R1');
      expect(ids).toContain('TX-VIS');
      expect(ids).toHaveLength(new Set(ids).size);
    },
  );
});

/**
 * The check that a task cannot be ticked over work addressed to it, SPEC 0's ninth class.
 *
 * THE CASE THAT PRODUCED IT IS THE FIRST ONE BELOW, WRITTEN AS IT HAPPENED. A question about a
 * NUL byte was filed against `T025`, `T025` ticked, no gate was built, and a third file acquired
 * the same defect. Nothing connected the two boxes, so nothing could have gone red.
 */
describe('parseAmendmentSections', () => {
  it('should read a per task section with its box, its title and its line', () => {
    // Given
    const text = ['# Amendments', '', '### [ ] `T025` The NUL byte question'].join('\n');

    // When
    const sections = parseAmendmentSections(splitLines(text));

    // Then
    expect(sections).toEqual([
      { taskId: 'T025', done: false, title: 'The NUL byte question', line: 3 },
    ]);
  });

  it('should take a retrofit and a task with no number for neither, since each owns its own work', () => {
    // Given, a retrofit stays open by design while the task it reopens keeps its original tick,
    // which is this file's own protocol. Reading one as a per task section would make the
    // mechanism contradict the document it enforces.
    const text = [
      '### [ ] `T005-R1` A retrofit',
      '### [ ] `TX-SLOTWIRE` A task with no number yet',
      'A sentence naming `T025` in prose',
    ].join('\n');

    // When
    const sections = parseAmendmentSections(splitLines(text));

    // Then
    expect(sections).toEqual([]);
  });
});

describe('checkAmendmentSections', () => {
  const tasks = parseContents(splitLines(buildFixture()));

  it('should fail a task that is ticked while a section addressed to it is open', () => {
    // Given, T001 is [x] in the fixture's CONTENTS
    const sections = parseAmendmentSections(
      splitLines('### [ ] `T001` Whether any gate scans the repository as text'),
    );

    // When
    const issues = checkAmendmentSections(sections, tasks);

    // Then
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe('amendment-open-on-closed-task');
    expect(issues[0]?.message).toContain('T001');
    expect(issues[0]?.message).toContain('Whether any gate scans the repository as text');
  });

  it('should say all three ways out, because one of them is unticking the task', () => {
    // Given, the wrong way out is deleting the section, and a message that named only the fix
    // would leave a session to invent the other two
    const sections = parseAmendmentSections(splitLines('### [ ] `T001` An open question'));

    // When
    const issues = checkAmendmentSections(sections, tasks);

    // Then
    expect(issues[0]?.message).toContain('untick T001');
    expect(issues[0]?.message).toContain('retrofit');
  });

  it('should pass a section that is open against a task that is not ticked', () => {
    // Given, T002 is [ ] in the fixture. This is the ordinary state of scheduled work and it is
    // what the check must not fire on, or every task with an amendment would start red.
    const sections = parseAmendmentSections(splitLines('### [ ] `T002` Additional clauses'));

    // When
    const issues = checkAmendmentSections(sections, tasks);

    // Then
    expect(issues).toEqual([]);
  });

  it('should pass a section that was answered before its task was ticked', () => {
    // Given, both boxes ticked, which is the state the mechanism exists to produce
    const sections = parseAmendmentSections(splitLines('### [x] `T001` Answered and ticked'));

    // When
    const issues = checkAmendmentSections(sections, tasks);

    // Then
    expect(issues).toEqual([]);
  });

  it('should fail a section addressed to a task the plan does not carry', () => {
    // Given, the reverse direction. A section addressed to nothing is read by nobody and is
    // indistinguishable from a section that was never written, which is the same reason every
    // other list in this repository is checked both ways.
    const sections = parseAmendmentSections(splitLines('### [ ] `T404` Addressed to nothing'));

    // When
    const issues = checkAmendmentSections(sections, tasks);

    // Then
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe('amendment-unknown-task');
    expect(issues[0]?.message).toContain('T404');
  });

  it('should report every offending section rather than stopping at the first', () => {
    // Given, four stood open against ticked tasks on the day this was written, and a check that
    // named one of them would have been read as a list of one
    const sections = parseAmendmentSections(
      splitLines(
        ['### [ ] `T001` First', '### [ ] `T001` Second', '### [ ] `T404` Third'].join('\n'),
      ),
    );

    // When
    const issues = checkAmendmentSections(sections, tasks);

    // Then
    expect(issues).toHaveLength(3);
  });
});

describe('parseOwnedEntries', () => {
  it('should read a retrofit and a TX entry with the milestone line each body declares', () => {
    // Given
    const text = [
      '## RETROFIT',
      '',
      '### [ ] `T005-R1` The second element shows what it is for',
      '',
      '**Milestone:** M2. Set on filing.',
      '',
      '### [x] `TX-SLOTWIRE` The page asks the registry',
      '',
      '**Milestone:** M1.',
    ].join('\n');

    // When
    const entries = parseOwnedEntries(splitLines(text));

    // Then
    expect(entries).toEqual([
      {
        id: 'T005-R1',
        done: false,
        title: 'The second element shows what it is for',
        line: 3,
        milestone: 'M2',
      },
      {
        id: 'TX-SLOTWIRE',
        done: true,
        title: 'The page asks the registry',
        line: 7,
        milestone: 'M1',
      },
    ]);
  });

  it('should not lend one entry the milestone of the next, since a borrowed expiry expires nothing', () => {
    // Given, the first entry declares no milestone and the second does
    const text = [
      '### [ ] `TX-SERVED` One quantity or two',
      'Prose that says owner M1 without a milestone line.',
      '### [ ] `TX-CLOCK` A threshold names its machine',
      '**Milestone:** M3.',
    ].join('\n');

    // When
    const entries = parseOwnedEntries(splitLines(text));

    // Then
    expect(entries[0]?.milestone).toBeUndefined();
    expect(entries[1]?.milestone).toBe('M3');
  });

  it('should end an entry body at the next heading, so a later section cannot supply the line', () => {
    // Given, a per task section between the entry and a milestone line
    const text = [
      '### [ ] `TX-VIS` The routes behind a guard',
      '',
      '### [ ] `T033` A theme cannot be selected',
      '',
      '**Milestone:** M9. This belongs to nothing.',
    ].join('\n');

    // When
    const entries = parseOwnedEntries(splitLines(text));

    // Then
    expect(entries).toHaveLength(1);
    expect(entries[0]?.milestone).toBeUndefined();
  });

  it('should take the first milestone line of a body, so a second cannot quietly loosen it', () => {
    // Given
    const text = [
      '### [ ] `TX-FIX` The source rewriter',
      '**Milestone:** M3.',
      '**Milestone:** M7.',
    ].join('\n');

    // When
    const entries = parseOwnedEntries(splitLines(text));

    // Then
    expect(entries[0]?.milestone).toBe('M3');
  });

  it('should read nothing from per task sections and prose', () => {
    // Given, the material of checkAmendmentSections rather than of this check
    const text = ['### [ ] `T033` A per task section', 'A sentence naming `TX-VIS` in prose.'].join(
      '\n',
    );

    // When
    const entries = parseOwnedEntries(splitLines(text));

    // Then
    expect(entries).toEqual([]);
  });
});

describe('checkOwnedEntries', () => {
  // Given, one closed milestone and one still open, which is the M1-and-M3 shape of the day
  // the check was written.
  const milestones = parseMilestones(
    splitLines(
      [
        '**M1 - CLOSED**',
        '',
        '- [x] `T001`  L0009-L0011  First task',
        '',
        '**M3 - OPEN**',
        '',
        '- [ ] `T002`  L0013-L0015  Second task',
      ].join('\n'),
    ),
  );

  it('should fail an open entry that declares no milestone, because memory is not an expiry', () => {
    // Given, the T005-R1 shape: filed, correct, and enforced by nothing
    const entries = parseOwnedEntries(splitLines('### [ ] `T005-R1` A live defect, filed'));

    // When
    const issues = checkOwnedEntries(entries, milestones);

    // Then
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe('entry-no-milestone');
    expect(issues[0]?.message).toContain('T005-R1');
  });

  it('should fail an open entry naming a milestone the plan does not carry', () => {
    // Given
    const entries = parseOwnedEntries(
      splitLines(['### [ ] `TX-VIS` The guard', '**Milestone:** M9.'].join('\n')),
    );

    // When
    const issues = checkOwnedEntries(entries, milestones);

    // Then
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe('entry-unknown-milestone');
    expect(issues[0]?.message).toContain('M9');
  });

  it('should fail an open entry whose milestone is finished, which is the TX-SERVED plant', () => {
    // Given, the exact shape the review of 2026-08-13 found three times: the entry says M1,
    // every M1 task is ticked, and nothing anywhere went red. This case is the check catching
    // its own author, run against the shape rather than against the file that has been fixed.
    const entries = parseOwnedEntries(
      splitLines(['### [ ] `TX-SERVED` One quantity or two', '**Milestone:** M1.'].join('\n')),
    );

    // When
    const issues = checkOwnedEntries(entries, milestones);

    // Then
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe('entry-milestone-closed');
    expect(issues[0]?.message).toContain('TX-SERVED');
    expect(issues[0]?.message).toContain('re-home');
  });

  it('should pass an open entry inside a live milestone, which is the ordinary state of scheduled work', () => {
    // Given
    const entries = parseOwnedEntries(
      splitLines(['### [ ] `TX-FIX` The source rewriter', '**Milestone:** M3.'].join('\n')),
    );

    // When
    const issues = checkOwnedEntries(entries, milestones);

    // Then
    expect(issues).toEqual([]);
  });

  it('should leave a closed entry alone, whatever its milestone says now', () => {
    // Given, a ticked entry is history: its milestone did its work, and a check that reopened
    // history would make closing an entry change nothing.
    const entries = parseOwnedEntries(
      splitLines(['### [x] `TX-SLOTWIRE` Wired', '**Milestone:** M1.'].join('\n')),
    );

    // When
    const issues = checkOwnedEntries(entries, milestones);

    // Then
    expect(issues).toEqual([]);
  });

  it('should report every offender rather than stopping at the first', () => {
    // Given, three entries went stale together on the day this was written
    const entries = parseOwnedEntries(
      splitLines(
        [
          '### [ ] `TX-SERVED` First',
          '**Milestone:** M1.',
          '### [ ] `TX-CLOCK` Second',
          '**Milestone:** M1.',
          '### [ ] `T005-R1` Third, with no line at all',
        ].join('\n'),
      ),
    );

    // When
    const issues = checkOwnedEntries(entries, milestones);

    // Then
    expect(issues).toHaveLength(3);
  });
});
