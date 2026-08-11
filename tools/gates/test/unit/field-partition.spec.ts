import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASSERTED_FIGURES,
  RECORDED_NOT_ASSERTED,
  readBrowserBaseline,
} from '../../src/lib/browser-baseline';
import { checkFieldPartition, unionOfFields } from '../../src/lib/field-partition';
import { CORPUS_MANIFEST_PARTITION, FONT_MANIFEST_PARTITION } from '../../src/lib/fixtures';

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');

/**
 * Reads the entries of a committed manifest.
 *
 * @param file - Repository relative path
 * @param key - The array key inside it
 * @returns The entries as plain records
 */
function entriesOf(file: string, key: string): Readonly<Record<string, unknown>>[] {
  const parsed = JSON.parse(readFileSync(join(repoRoot, file), 'utf8')) as Record<
    string,
    Readonly<Record<string, unknown>>[]
  >;
  return parsed[key] ?? [];
}

describe('checkFieldPartition', () => {
  const partition = {
    record: 'record.json',
    asserted: { checked: 'the gate that reads it' },
    recordedNotAsserted: { carried: 'prose for a reader, with nothing to check it against' },
  };

  it('should be silent when every field is on exactly one side', () => {
    // Given
    // When
    const issues = checkFieldPartition(['checked', 'carried'], partition);

    // Then
    expect(issues).toEqual([]);
  });

  it('should report a field the record carries and neither list names', () => {
    // Given the whole point: the eighteenth entry introducing a field nobody decided about
    // When
    const issues = checkFieldPartition(['checked', 'carried', 'newcomer'], partition);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['unaccounted']);
    expect(issues[0]?.field).toBe('newcomer');
  });

  it('should report a field listed as both checked and unchecked', () => {
    // Given, since the two lists mean opposite things and a field in both means neither
    const both = {
      ...partition,
      asserted: { checked: 'a gate', carried: 'also a gate' },
    };

    // When
    const issues = checkFieldPartition(['checked', 'carried'], both);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['both-lists']);
  });

  it('should report a list entry for a field the record no longer carries', () => {
    // Given a renamed field, which leaves behind an entry that can never fire again
    // When
    const issues = checkFieldPartition(['checked'], partition);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['stale']);
    expect(issues[0]?.field).toBe('carried');
  });

  it('should refuse a reason that says nothing', () => {
    // Given, because "nobody got round to it" is the state this list exists to make visible
    const lazy = { ...partition, recordedNotAsserted: { carried: 'todo' } };

    // When
    const issues = checkFieldPartition(['checked', 'carried'], lazy);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['reason-too-short']);
  });
});

describe('unionOfFields', () => {
  it('should find a field present on one entry of many', () => {
    // Given, since an optional field on one entry of seventeen is what a sample misses
    const entries = [{ a: 1 }, { a: 1, b: 2 }, { a: 1 }];

    // When
    // Then
    expect(unionOfFields(entries)).toEqual(['a', 'b']);
  });
});

describe('the committed records', () => {
  it('should account for every field of the corpus manifest', () => {
    // Given the real file, all seventeen entries
    const entries = entriesOf('packages/core/test/corpus/manifest.json', 'documents');

    // When
    const issues = checkFieldPartition(unionOfFields(entries), CORPUS_MANIFEST_PARTITION);

    // Then
    expect(entries.length).toBeGreaterThanOrEqual(15);
    expect(issues.map((issue) => issue.message)).toEqual([]);
  });

  it('should account for every field of the font manifest', () => {
    // Given the real file, all ten assets
    const entries = entriesOf('packages/theme/fonts/manifest.json', 'assets');

    // When
    const issues = checkFieldPartition(unionOfFields(entries), FONT_MANIFEST_PARTITION);

    // Then
    expect(entries.length).toBeGreaterThan(0);
    expect(issues.map((issue) => issue.message)).toEqual([]);
  });

  it('should account for every field of the browser baseline, through the same function', () => {
    // Given the record the mechanism was written for. It carried its own copy of this walk, and
    // one implementation for three records is the point of lifting it.
    const { baseline: record } = readBrowserBaseline(repoRoot);
    if (record === null) throw new Error('no baseline');

    // When
    const issues = checkFieldPartition(Object.keys(record), {
      record: 'tools/browser-budget/baseline.json',
      asserted: ASSERTED_FIGURES,
      recordedNotAsserted: RECORDED_NOT_ASSERTED,
    });

    // Then
    expect(issues.map((issue) => issue.message)).toEqual([]);
  });
});
