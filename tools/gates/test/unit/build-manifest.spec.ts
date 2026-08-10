import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILD_FILE,
  BUILD_TASK_COUNT,
  REQUIRED_DOC_MIN_BYTES,
  REQUIRED_DOCS,
} from '../../src/config';
import {
  checkBuildManifest,
  checkRequiredDocs,
  parseContents,
  parseMilestones,
  planTaskIds,
  splitLines,
} from '../../src/lib/build-manifest';

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
  it('should all be present and hold content right now', () => {
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

  it('should read the real BUILD.md as eight milestones covering every task', () => {
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
  });
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

  it('should give the two gates that call it the same answer for the real files', () => {
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
  });
});
