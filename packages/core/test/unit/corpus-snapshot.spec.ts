import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IRDocument } from '../../src/index';
import { canonicalize, hash, normalizeOpenApiDocument, parseSpecification } from '../../src/index';

/**
 * The corpus snapshot harness, per SPEC 21 and BUILD T006.
 *
 * Two kinds of snapshot, because one kind cannot serve both documents in the corpus.
 *
 * A small document gets its whole normalized IR written out. That is the readable form: when
 * something changes, the diff says what.
 *
 * A large one gets a digest instead. Stripe's IR is 5.3 MB and no one reviews a diff that
 * size, so writing it out would produce a file that is always accepted rather than read. The
 * digest still pins every byte, because it carries the document hash, which is taken over the
 * canonical serialization of the whole IR. The rest of the digest, the counts and the per
 * schema hashes, exists so that a changed document hash can be located rather than merely
 * noticed.
 *
 * Adding a document is a line in `manifest.json` and a new snapshot file.
 */

const CORPUS = join(import.meta.dirname, '..', 'corpus');
const SNAPSHOTS = join(CORPUS, 'snapshots');

/** Below this, the whole IR is written out, because the diff is reviewable. */
const READABLE_DOCUMENT_BYTES = 16 * 1024;

interface ManifestEntry {
  readonly file: string;
  readonly title: string;
}

function manifest(): ManifestEntry[] {
  const parsed = JSON.parse(readFileSync(join(CORPUS, 'manifest.json'), 'utf8')) as {
    documents: ManifestEntry[];
  };
  return [...parsed.documents].sort((a, b) => a.file.localeCompare(b.file));
}

function sourceOf(file: string): string {
  return readFileSync(join(CORPUS, 'documents', file), 'utf8');
}

function normalize(file: string): IRDocument {
  return normalizeOpenApiDocument(parseSpecification(sourceOf(file)));
}

/** A stable, readable rendering of the whole IR. */
function fullSnapshot(document: IRDocument): string {
  return `${JSON.stringify(JSON.parse(canonicalize(document)), null, 2)}\n`;
}

/** A stable summary that locates a change without carrying the whole document. */
function digestSnapshot(document: IRDocument): string {
  const digest = {
    hash: document.hash,
    id: document.id,
    kind: document.kind,
    info: { title: document.info.title, version: document.info.version },
    counts: {
      nodes: document.nodes.size,
      schemas: document.schemas.size,
      webhooks: document.webhooks.size,
      servers: document.servers.length,
      security: document.security.length,
      navigation: document.navigation.length,
    },
    navigation: document.navigation.map(
      (group) => `${group.kind} ${group.label} (${String(group.children.length)})`,
    ),
    nodes: [...document.nodes.keys()],
    schemas: [...document.schemas.entries()].map(
      ([id, schema]) =>
        `${id} ${schema.dialect} ${hash(schema.normalized ?? schema.raw ?? null).slice(0, 16)}`,
    ),
  };

  return `${JSON.stringify(digest, null, 2)}\n`;
}

describe('corpus snapshots', () => {
  const entries = manifest();

  it('should hold at least fifteen documents, per SPEC 21', () => {
    // Given
    const files = entries.map((entry) => entry.file);

    // When
    const count = files.length;

    // Then
    expect(count).toBeGreaterThanOrEqual(15);
  });

  for (const entry of entries) {
    const readable = Buffer.byteLength(sourceOf(entry.file), 'utf8') < READABLE_DOCUMENT_BYTES;
    const kind = readable ? 'ir' : 'digest';

    it(`should match the recorded ${kind} for ${entry.file}`, async () => {
      // Given
      const document = normalize(entry.file);

      // When
      const rendered = readable ? fullSnapshot(document) : digestSnapshot(document);

      // Then
      await expect(rendered).toMatchFileSnapshot(join(SNAPSHOTS, `${entry.file}.${kind}.json`));
    }, 120_000);
  }

  it('should match the recorded size report, so a change in normalization cost is visible', async () => {
    // Given, the columns are all deterministic. Wall clock is deliberately absent: a
    // committed timing churns on every machine and would train a reader to accept the diff.
    // Time is bounded instead, machine independently, in normalization-cost.spec.ts.
    const rows = entries.map((entry) => {
      const inputBytes = Buffer.byteLength(sourceOf(entry.file), 'utf8');
      const document = normalize(entry.file);
      const outputBytes = canonicalize({ ...document, hash: '' }).length;

      return [
        entry.file,
        String(inputBytes),
        String(outputBytes),
        (outputBytes / inputBytes).toFixed(2),
        String(document.nodes.size),
        String(document.schemas.size),
      ];
    });

    // When
    const header = ['document', 'source bytes', 'IR bytes', 'ratio', 'nodes', 'schemas'];
    const table = [header, header.map(() => '---'), ...rows]
      .map((row) => `| ${row.join(' | ')} |`)
      .join('\n');

    const report = `# Corpus normalization cost

Generated by \`corpus-snapshot.spec.ts\`. Every column is deterministic, so a change here is a
change in what normalization produces rather than in the machine that ran it.

Wall clock is not a column on purpose. It differs per machine, so committing it would produce
a diff on every run and teach whoever reads it to accept the file unread. Time is bounded in
\`normalization-cost.spec.ts\` instead, against input size and with enough headroom to be
machine independent.

The ratio is the number to watch. It was the symptom of expanding every reference at every use
site, which is what SPEC 5.1.1 replaced.

${table}
`;

    // Then
    await expect(report).toMatchFileSnapshot(join(CORPUS, 'report.md'));
  }, 300_000);

  it('should produce the same IR on two consecutive runs of every document', () => {
    // Given
    const files = entries.map((entry) => entry.file);

    // When
    const differing = files.filter((file) => normalize(file).hash !== normalize(file).hash);

    // Then
    expect(differing).toEqual([]);
  }, 300_000);

  it('should give a document the hash it records for itself', () => {
    // Given
    const files = entries.map((entry) => entry.file);

    // When
    const wrong = files.filter((file) => {
      const document = normalize(file);
      return document.hash !== hash({ ...document, hash: '' });
    });

    // Then
    expect(wrong).toEqual([]);
  }, 300_000);
});
