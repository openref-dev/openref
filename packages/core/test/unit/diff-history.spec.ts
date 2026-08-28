import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IRDiffChange, IRDocument } from '../../src/index';
import {
  buildDiffReport,
  canonicalize,
  normalizeOpenApiDocument,
  parseSpecification,
} from '../../src/index';

/**
 * The T038 measurement: the diff classification run across a real, consecutive version history,
 * per SPEC 17.1 and the task's own done-when.
 *
 * The material is `test/history/documents`: twenty four consecutive versions of the Swagger
 * Petstore `openapi.yaml`, one per commit that touched the file, vendored with manifest and
 * NOTICE like the corpus. The window spans release bumps that change nothing, a specification
 * cleanup wave (OpenAPI 3.0.2 to 3.0.4, default responses reworked twice), and one commit whose
 * message states a contract change outright.
 *
 * THE CLASSIFICATION WAS REVIEWED BY HAND ONCE, 2026-08-27, against the underlying yaml diffs,
 * and then snapshotted. The review's findings, so the snapshot is read with them in mind:
 *
 * - 19 of 23 pairs are empty. Release bumps edit only `info.version`, which is annotation.
 * - every breaking finding in the window traces to a real edit of the declared contract: the
 *   default responses changing their declared schema from the success type to `Error`
 *   (011 to 012), and two query parameters becoming required (019 to 020), which is exactly
 *   what commit 9fb97b1 says it does.
 * - phantom breaking findings, the class the done-when is about: zero.
 *
 * RE-DERIVED 2026-08-28 FOR THE PRE-M4 REVIEW, which put response headers in scope, made a
 * request side constraint tightening breaking, and overturned the presence rule. Breaking moved
 * from 15 to 17, non breaking stayed at 73 and the empty count at 19, in the same 23 pairs. Both
 * new lines are in pair 011 to 012 and were checked by hand against the raw yaml: the `default`
 * response of `GET /user/login`, which was a duplicate of the `200` down to its two headers, is
 * rewritten there as an `Error` with no headers at all, so `X-Rate-Limit` and `X-Expires-After`
 * both leave a declared response. It is the same edit the pair's existing
 * `type-changed  response default of GET /user/login` line already reports, and the classifier
 * had been reporting half of it. Phantom breaking findings, which is what the done-when is
 * about: still zero, and the three classes that changed added none.
 *
 * RE-DERIVED 2026-08-27 FOR THE T038 REWORK RULING that makes servers changes register as non
 * breaking. The regeneration moved the totals from 72 to 73 non breaking findings; breaking
 * stayed at 15 and the empty count at 19, in the same 23 pairs. The one new line was checked by
 * hand against the raw yaml: in pair 011 to 012 the single declared server, line 24 of both
 * files, moves from `/v3` to `https://petstore3.swagger.io/api/v3`, with no description and no
 * variables on either side, so it renders as one `server-changed` url move. The `openapi` bump
 * 3.0.2 to 3.0.4 in pair 010 to 011 stays invisible by the same ruling, and that pair's
 * section did not change.
 */

const HISTORY = join(import.meta.dirname, '..', 'history');

interface HistoryEntry {
  readonly file: string;
}

function versions(): string[] {
  const manifest = JSON.parse(readFileSync(join(HISTORY, 'manifest.json'), 'utf8')) as {
    documents: HistoryEntry[];
  };
  return manifest.documents.map((entry) => entry.file).sort();
}

function normalize(file: string): IRDocument {
  const source = readFileSync(join(HISTORY, 'documents', file), 'utf8');
  return normalizeOpenApiDocument(parseSpecification(source, { source: file }));
}

/** One change as a stable, reviewable line. */
function renderChange(change: IRDiffChange): string {
  const parts = [`- ${change.kind}  ${change.subject}`];
  if (change.oldValue !== undefined && change.newValue !== undefined) {
    parts.push(`  ${change.oldValue} -> ${change.newValue}`);
  }
  if (change.values !== undefined && change.values.length > 0) {
    parts.push(`  [${change.values.join(', ')}]`);
  }
  return parts.join('');
}

describe('diff over a real version history', () => {
  const files = versions();

  it('should hold at least twenty consecutive versions, the T038 floor', () => {
    // Given
    // When
    const count = files.length;

    // Then
    expect(count).toBeGreaterThanOrEqual(20);
  });

  it('should classify the requiredness change commit 9fb97b1 states in its own message', () => {
    // Given the pair around "Change status/tag to required param for findbystatus/findbytag
    // endpoints", the one commit of the window whose message names a contract change. This is
    // the hand review's anchor, pinned as an assertion rather than left to the snapshot.
    const before = files.find((file) => file.startsWith('019-'));
    const after = files.find((file) => file.startsWith('020-'));
    if (before === undefined || after === undefined) throw new Error('window changed');

    // When
    const report = buildDiffReport(normalize(before), normalize(after));

    // Then
    expect(report.breaking).toEqual([
      {
        kind: 'requiredness-changed',
        classification: 'breaking',
        subject: 'query parameter status of GET /pet/findByStatus',
        oldValue: 'optional',
        newValue: 'required',
      },
      {
        kind: 'requiredness-changed',
        classification: 'breaking',
        subject: 'query parameter tags of GET /pet/findByTags',
        oldValue: 'optional',
        newValue: 'required',
      },
    ]);
    expect(report.nonBreaking).toEqual([]);
  });

  it('should produce byte identical reports on two runs over one pair', () => {
    // Given the busiest pair of the window
    const older = files.find((file) => file.startsWith('011-'));
    const newer = files.find((file) => file.startsWith('012-'));
    if (older === undefined || newer === undefined) throw new Error('window changed');

    // When
    const first = canonicalize(buildDiffReport(normalize(older), normalize(newer)));
    const second = canonicalize(buildDiffReport(normalize(older), normalize(newer)));

    // Then
    expect(first).toBe(second);
  });

  it(
    'should match the reviewed classification of every consecutive pair',
    { timeout: 120_000 },
    async () => {
      // Given every consecutive pair of the window
      const documents = files.map((file) => [file, normalize(file)] as const);

      const sections: string[] = [];
      let empty = 0;
      let breakingTotal = 0;
      let nonBreakingTotal = 0;

      // When
      for (let index = 1; index < documents.length; index += 1) {
        const [oldFile, oldDocument] = documents[index - 1] ?? ['', undefined];
        const [newFile, newDocument] = documents[index] ?? ['', undefined];
        if (oldDocument === undefined || newDocument === undefined) continue;

        const report = buildDiffReport(oldDocument, newDocument);
        breakingTotal += report.breaking.length;
        nonBreakingTotal += report.nonBreaking.length;

        const lines = [`## ${oldFile} -> ${newFile}`, ''];
        if (report.breaking.length === 0 && report.nonBreaking.length === 0) {
          empty += 1;
          lines.push('no changes');
        } else {
          if (report.breaking.length > 0) {
            lines.push('BREAKING', ...report.breaking.map(renderChange));
          }
          if (report.nonBreaking.length > 0) {
            if (report.breaking.length > 0) lines.push('');
            lines.push('NON-BREAKING', ...report.nonBreaking.map(renderChange));
          }
        }
        sections.push(lines.join('\n'));
      }

      const rendered = `# Swagger Petstore, ${String(files.length)} consecutive versions, classified pairwise

Generated by \`diff-history.spec.ts\` over \`test/history/documents\`, oldest to newest.
The classification was reviewed by hand against the underlying yaml once, 2026-08-27,
per T038; since then this file is the pin. A change here is a change in what the
classifier says about the same twenty four documents, and has to be re-reviewed, not
accepted.

Of ${String(files.length - 1)} pairs: ${String(empty)} empty, ${String(breakingTotal)} breaking findings, ${String(nonBreakingTotal)} non breaking findings.

${sections.join('\n\n')}
`;

      // Then, the review found real changes on both sides of the gate and no phantom ones; a
      // window that stopped containing either would prove nothing, so both are asserted before
      // the snapshot pins the rest.
      expect(breakingTotal).toBeGreaterThan(0);
      expect(empty).toBeGreaterThan(0);
      await expect(rendered).toMatchFileSnapshot(join(HISTORY, 'snapshots', 'petstore-diff.md'));
    },
  );
});
