import { statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REQUIRED_DOC_MIN_BYTES, REQUIRED_DOCS } from '../../src/config';
import {
  checkBuildManifest,
  checkRequiredDocs,
  parseContents,
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
