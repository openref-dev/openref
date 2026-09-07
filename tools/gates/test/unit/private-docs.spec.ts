import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PRIVATE_DOCS_MIN_FILES,
  PRIVATE_DOC_EXEMPTIONS,
  findInText,
  listTrackedFiles,
  scanTrackedForPrivateDocs,
} from '../../src/lib/private-docs';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * The check planted on a synthetic tree, both ways.
 *
 * A CHECK THAT ONLY READS THE REAL REPOSITORY IS A CHECK THAT TODAY IS CLEAN, and says nothing
 * about whether it could ever go red. The cases below put a reference in, watch the scan find
 * it, take it out, and watch the scan pass, which is the only evidence that a green run means
 * anything at all.
 *
 * THE UNTRACKED CASE IS THE ONE THAT MATTERS MOST. The private documents exist on the
 * maintainer's machine and in no clone, so a scan that walks the filesystem reports a clean
 * repository for the person who has them and a dirty one for everybody else. The case below
 * writes a file, does not commit it, and asserts the scan does not see it.
 */
const root = mkdtempSync(join(tmpdir(), 'oref-private-docs-spec-'));

function git(...args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=spec',
      '-c',
      'user.email=spec@localhost',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: root, encoding: 'utf8' },
  ).trim();
}

function write(relative: string, content: string): void {
  const absolute = join(root, relative);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, content);
}

function commitAll(message: string): void {
  git('add', '-A');
  git('commit', '-q', '-m', message);
}

beforeAll(() => {
  git('init', '-q');
  write('packages/clean.ts', '// A comment that cites nothing private.\n');
  commitAll('clean tree');
}, SPAWNED_PROCESS_TIMEOUT_MS);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('scanTrackedForPrivateDocs', () => {
  it('should find nothing on a tracked tree that cites neither document', () => {
    // Given a committed tree whose only file cites nothing private
    // When
    const scan = scanTrackedForPrivateDocs(root, []);

    // Then
    expect(scan.error).toBeUndefined();
    expect(scan.scanned).toBeGreaterThan(0);
    expect(scan.hits).toEqual([]);
  });

  it('should go red when a tracked file is made to cite the specification', () => {
    // Given the reference planted in a tracked file, which is the leak this gate exists for
    write('packages/leaky.ts', '/**\n * The rule, per `ai-docs/SPEC.md` section 0.\n */\n');
    commitAll('plant a reference');

    // When
    const scan = scanTrackedForPrivateDocs(root, []);

    // Then
    expect(scan.hits.map((hit) => hit.path)).toContain('packages/leaky.ts');
    expect(scan.hits.find((hit) => hit.path === 'packages/leaky.ts')?.token).toBe('ai-docs');
  });

  it('should go green again when the reference is removed', () => {
    // Given the same file with the justification kept and the pointer gone
    write('packages/leaky.ts', '/**\n * The rule, which holds because it is the rule.\n */\n');
    commitAll('remove the reference');

    // When
    const scan = scanTrackedForPrivateDocs(root, []);

    // Then
    expect(scan.hits).toEqual([]);
  });

  it('should go red when a tracked file names the instructions file', () => {
    // Given the second spelling, which is the smaller half of the same leak
    write('packages/rule.ts', '// forbidden per CLAUDE.md rule 5\n');
    commitAll('plant the second spelling');

    // When
    const scan = scanTrackedForPrivateDocs(root, []);

    // Then
    expect(scan.hits.find((hit) => hit.path === 'packages/rule.ts')?.token).toBe('CLAUDE.md');

    // And when the pointer is replaced by the argument itself
    write(
      'packages/rule.ts',
      '// forbidden: it would invent a fact the application cannot produce\n',
    );
    commitAll('state the argument instead');

    expect(scanTrackedForPrivateDocs(root, []).hits).toEqual([]);
  });

  it('should not see a file git does not track, which is the distinction that was missed', () => {
    // Given the private document itself present on disk and deliberately never committed
    write('ai-docs/SPEC.md', '# The specification\n\nSection 0 says something.\n');

    // When
    const scan = scanTrackedForPrivateDocs(root, []);

    // Then the scan reads the tracked set and never the working tree, so the document that is
    // present here and absent on every clone changes nothing about the answer
    expect(scan.hits).toEqual([]);
    expect(listTrackedFiles(root).files).not.toContain('ai-docs/SPEC.md');

    rmSync(join(root, 'ai-docs'), { recursive: true, force: true });
  });

  it('should hold a reference that is exempt by path and still report an exemption that covers nothing', () => {
    // Given one file that cites a document and is allowed to, and one exemption that does not
    write('tools/subject.ts', "const SPEC = 'ai-docs/SPEC.md';\n");
    commitAll('a file whose subject is the document');

    // When
    const scan = scanTrackedForPrivateDocs(root, [
      { file: 'tools/subject.ts', reason: 'reads the document' },
      { file: 'packages/clean.ts', reason: 'covers nothing any more' },
    ]);

    // Then the exempt reference is held
    expect(scan.hits).toEqual([]);

    // And the exemption that matches nothing is reported, because a standing permission over a
    // file with no reference silently pre-authorizes the next one written into it
    expect(scan.staleExemptions.map((exemption) => exemption.file)).toEqual(['packages/clean.ts']);
  });

  it('should report an exemption for a path git does not track', () => {
    // Given an exemption naming a file that is not in the repository
    // When
    const scan = scanTrackedForPrivateDocs(root, [
      { file: 'packages/gone.ts', reason: 'left the repository' },
    ]);

    // Then
    expect(scan.untrackedExemptions.map((exemption) => exemption.file)).toEqual([
      'packages/gone.ts',
    ]);
  });

  it('should report an error rather than a clean reading when git cannot answer', () => {
    // Given a directory that is not a repository at all
    const outside = mkdtempSync(join(tmpdir(), 'oref-not-a-repo-'));

    // When
    const scan = scanTrackedForPrivateDocs(outside, []);

    // Then a failure to read is never a clean result
    expect(scan.error).toBeDefined();
    expect(scan.scanned).toBe(0);

    rmSync(outside, { recursive: true, force: true });
  });
});

describe('findInText', () => {
  it('should match the bare directory name and the path form, and not a longer word', () => {
    // Given all three spellings on their own lines
    const text = [
      'see ai-docs for it',
      'see `ai-docs/SPEC.md`',
      'tools/gates/ai-docs-projection.json',
    ].join('\n');

    // When
    const hits = findInText('x.ts', text);

    // Then the artefact's own file name is not a citation of the private directory, so it is
    // not a hit, and the two real spellings are
    expect(hits.map((hit) => hit.line)).toEqual([1, 2]);
  });

  it('should report every occurrence on a line, not just the first', () => {
    // Given two citations on one line
    // When
    const hits = findInText('x.ts', 'per `ai-docs/SPEC.md` and `ai-docs/BUILD.md`');

    // Then
    expect(hits).toHaveLength(2);
    expect(hits[0]?.column).toBeLessThan(hits[1]?.column ?? 0);
  });
});

describe('the exemption table', () => {
  it('should give every exemption a path and a reason', () => {
    // Given the committed table
    // When, Then each entry is a concrete path rather than a pattern, so a glob can never
    // quietly widen it
    for (const exemption of PRIVATE_DOC_EXEMPTIONS) {
      expect(exemption.file).not.toContain('*');
      expect(exemption.reason.length).toBeGreaterThan(20);
    }
  });

  it('should name each path once', () => {
    // Given the committed table
    const paths = PRIVATE_DOC_EXEMPTIONS.map((exemption) => exemption.file);

    // When, Then
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('should keep a floor that makes an empty reading fail', () => {
    // Given the floor
    // When, Then a reading of nothing must not be able to pass as a reading of a clean tree
    expect(PRIVATE_DOCS_MIN_FILES).toBeGreaterThan(100);
  });
});
