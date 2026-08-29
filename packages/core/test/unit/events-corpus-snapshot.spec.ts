import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IRChannel, IRDocument } from '../../src/index';
import { canonicalize, hash, normalizeAsyncApiDocument, parseSpecification } from '../../src/index';
import { documentShape, renderShape } from './corpus-shape';
import {
  eventFieldUsage,
  EVENT_FIELD_SUBJECTS,
  type EventFieldSubject,
} from './events-corpus-fields';

/**
 * The event corpus snapshot harness, per SPEC 21 and BUILD `T049`.
 *
 * IT IS THE SAME HARNESS AS `T006`'s, ON PURPOSE AND NOT BY COINCIDENCE. The threshold, the two
 * kinds of artefact, the shape renderer and the report are the HTTP corpus's, so an event document
 * gets the regression net an HTTP document has had since M0 rather than a second, weaker one. What
 * differs is the reader: `normalizeAsyncApiDocument` instead of `normalizeOpenApiDocument`, which
 * is why the documents sit in a second directory with their own manifest and NOTICE.
 *
 * THIS SUITE ALSO CARRIES THE FIELD MEASUREMENT THE MAINTAINER'S RULING OF 2026-08-29 ORDERED.
 * Six members of AsyncAPI had no IR carrier at the close of `T048`, and the ruling was to add what
 * the corpus uses, drop what it does not, and record both lists with counts. The counts are
 * measured here, written into `report.md`, and tied to the IR: a member the corpus writes and the
 * IR carries is read back off the normalized document, so a carrier that stops carrying breaks a
 * case rather than quietly reverting the decision. Since `T051` all six are carried, and the
 * suite also states which of AsyncAPI's thirteen security scheme types this corpus reaches, in
 * both directions, so its silence about the other five is a measurement rather than an omission.
 */

const CORPUS = join(import.meta.dirname, '..', 'events-corpus');
const SNAPSHOTS = join(CORPUS, 'snapshots');

/** Below this, the whole IR is written out, because the diff is reviewable. */
const READABLE_DOCUMENT_BYTES = 16 * 1024;

/**
 * All six members, and where the carrier of each is read back from.
 *
 * IT WAS FOUR UNTIL `T051`. `T049` took the minor half of the maintainer's ruling of 2026-08-29
 * and gave a carrier to the four an optional field could hold; the two `security` members needed
 * `IRSecuritySchemeType` to grow past its five OpenAPI names, which is the breaking half of
 * `ai-docs/design/CONTRACT.md` and was ruled to belong to `T051`. Both now have one, so the
 * comparison below covers the whole of SPEC 8.2's list rather than two thirds of it.
 */
const CARRIED: Readonly<Record<string, (document: IRDocument) => number>> = {
  'servers[].bindings': (document) =>
    document.servers.filter((server) => server.bindings !== undefined).length,
  'servers[].security': (document) =>
    document.servers.filter((server) => server.security !== undefined).length,
  'operations[].reply': (document) =>
    everyOperation(document).filter((operation) => operation.reply !== undefined).length,
  'operations[].security': (document) =>
    everyOperation(document).filter((operation) => operation.security !== undefined).length,
  'operations[].tags': (document) =>
    everyOperation(document).filter((operation) => operation.tags !== undefined).length,
  'messages[].tags': (document) =>
    everyChannel(document)
      .flatMap((channel) => channel.messages)
      .filter((message) => message.tags !== undefined).length,
};

/**
 * The thirteen types AsyncAPI declares, spelled here rather than imported from the normalizer.
 *
 * The corpus writes eight of them and never writes the other five, which the case below asserts
 * in both directions: a corpus that stopped writing one would otherwise look the same as a reader
 * that stopped reading it.
 */
const THIRTEEN_TYPES: readonly string[] = [
  'userPassword',
  'apiKey',
  'X509',
  'symmetricEncryption',
  'asymmetricEncryption',
  'httpApiKey',
  'http',
  'oauth2',
  'openIdConnect',
  'plain',
  'scramSha256',
  'scramSha512',
  'gssapi',
];

/** The two members whose carriers `T051` added, named rather than derived from the table above. */
const SECURITY_MEMBERS: readonly EventFieldSubject[] = [
  'servers[].security',
  'operations[].security',
];

/** The eight of the thirteen the corpus writes, measured 2026-08-29 and pinned here. */
const TYPES_IN_CORPUS: readonly string[] = [
  'X509',
  'apiKey',
  'http',
  'httpApiKey',
  'oauth2',
  'openIdConnect',
  'plain',
  'scramSha256',
];

interface ManifestEntry {
  readonly file: string;
  readonly title: string;
  readonly license: string;
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

function parse(file: string): unknown {
  return parseSpecification(sourceOf(file));
}

function normalize(file: string): IRDocument {
  return normalizeAsyncApiDocument(parse(file));
}

function everyChannel(document: IRDocument): IRChannel[] {
  return [...document.nodes.values()].filter((node): node is IRChannel => node.kind === 'channel');
}

function everyOperation(document: IRDocument): IRChannel['operations'][number][] {
  return everyChannel(document).flatMap((channel) => channel.operations);
}

/** The AsyncAPI version a document declares, read for the coverage table rather than for the IR. */
function editionOf(file: string): string {
  const document = parse(file);
  const declared =
    typeof document === 'object' && document !== null
      ? (document as Record<string, unknown>).asyncapi
      : undefined;
  return typeof declared === 'string' ? declared : '(none)';
}

/** Distinct protocols the document's servers declare, in canonical order. */
function protocolsOf(document: IRDocument): string[] {
  const protocols = new Set<string>();
  for (const server of document.servers) {
    if (server.protocol !== undefined) protocols.add(server.protocol);
  }
  return [...protocols].sort((left, right) => left.localeCompare(right));
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
      servers: document.servers.length,
      operations: everyOperation(document).length,
      messages: everyChannel(document).reduce(
        (total, channel) => total + channel.messages.length,
        0,
      ),
      navigation: document.navigation.length,
    },
    protocols: protocolsOf(document),
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

describe('event corpus snapshots', () => {
  const entries = manifest();

  it('should hold at least five documents across different protocols, per SPEC 21', () => {
    // Given
    const documents = entries.map((entry) => normalize(entry.file));

    // When
    const protocols = new Set(documents.flatMap(protocolsOf));
    const editions = new Set(entries.map((entry) => editionOf(entry.file)));

    // Then, and both editions SPEC 8.1 accepts are represented, because a corpus carrying one of
    // them proves nothing about the other
    expect(entries.length).toBeGreaterThanOrEqual(5);
    expect(protocols.size).toBeGreaterThanOrEqual(5);
    expect([...editions].sort()).toEqual(['3.0.0', '3.1.0']);
  }, 120_000);

  it('should normalize every document without error', () => {
    // Given, the whole manifest, so a document that stops normalizing is named rather than
    // taking the suite down at whichever case reached it first
    const failures = entries.map((entry) => {
      try {
        normalize(entry.file);
        return null;
      } catch (error) {
        return `${entry.file}: ${(error as Error).message}`;
      }
    });

    // When
    const refused = failures.filter((failure): failure is string => failure !== null);

    // Then
    expect(refused).toEqual([]);
  }, 120_000);

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

    if (readable) continue;

    it(`should match the recorded shape for ${entry.file}`, async () => {
      // Given
      const document = normalize(entry.file);

      // When
      const rendered = renderShape(entry.file, documentShape(document));

      // Then
      await expect(rendered).toMatchFileSnapshot(join(SNAPSHOTS, `${entry.file}.shape.md`));
    }, 120_000);
  }

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

  it('should read every document as an events document', () => {
    // Given, the discriminant SPEC 5.1 reserved in `T002` and `T048` filled
    const kinds = entries.map((entry) => normalize(entry.file).kind);

    // When
    const distinct = [...new Set(kinds)];

    // Then, and `mixed` is not among them by construction: no specification format writes both
    // HTTP operations and channels, so the only producer of that kind is the federated merge,
    // which is proved over these same documents in `packages/federation`.
    expect(distinct).toEqual(['events']);
  }, 300_000);

  it('should carry every member the corpus writes and this IR holds', () => {
    // Given all six members of SPEC 8.2's list, four carried at `T049` and both `security`
    // members at `T051`. The comparison below is worth nothing unless the corpus writes them, so
    // the raw count is asserted non zero first: a corpus that stopped carrying one of these
    // documents would otherwise prove the carrier correct by comparing zero with zero.
    const rows = Object.entries(CARRIED).map(([subject, carried]) => {
      const written = entries.reduce(
        (total, entry) => total + eventFieldUsage(parse(entry.file))[subject as EventFieldSubject],
        0,
      );
      const produced = entries.reduce((total, entry) => total + carried(normalize(entry.file)), 0);
      return { subject, written, produced };
    });

    // When
    const unwritten = rows.filter((row) => row.written === 0);
    const lost = rows.filter((row) => row.written !== row.produced);

    // Then, and the two numbers agree member by member: the input walk and the normalizer are
    // separate implementations of the same reading, so a disagreement is a defect in one of them.
    expect(unwritten).toEqual([]);
    expect(lost).toEqual([]);
  }, 300_000);

  it('should now carry the security both members declare, which was the T051 decision', () => {
    // Given, the presence half first: the corpus writes both members, which is what made their
    // absence from the IR a decision worth recording and now makes their presence a reading
    const written = SECURITY_MEMBERS.map((subject) => ({
      subject,
      count: entries.reduce(
        (total, entry) => total + eventFieldUsage(parse(entry.file))[subject],
        0,
      ),
    }));
    expect(written.filter((row) => row.count === 0)).toEqual([]);

    // When
    const documents = entries.map((entry) => normalize(entry.file));
    const withSchemes = documents.filter((document) => document.security.length > 0);
    const requirements = documents.flatMap((document) => [
      ...document.servers.flatMap((server) => server.security ?? []),
      ...everyOperation(document).flatMap((operation) => operation.security ?? []),
    ]);

    // Then, per SPEC 8.2: the schemes are in the document table and every requirement names one
    // of them. A requirement pointing at nothing would be a scheme table read at the wrong time,
    // which is the defect the declared block being read before the servers exists to prevent.
    expect(withSchemes.length).toBe(8);
    expect(requirements.length).toBeGreaterThan(0);
    const dangling = documents.flatMap((document) => {
      const ids = new Set(document.security.map((scheme) => scheme.id));
      const named = [
        ...document.servers.flatMap((server) => server.security ?? []),
        ...everyOperation(document).flatMap((operation) => operation.security ?? []),
      ];
      return named.filter((requirement) => !ids.has(requirement.schemeId));
    });
    expect(dangling).toEqual([]);
  }, 300_000);

  it('should read eight of the thirteen scheme types here, and be silent about the other five', () => {
    // Given the whole table, and the eight the corpus was measured to write on 2026-08-29
    expect(THIRTEEN_TYPES).toHaveLength(13);

    // When
    const produced = new Set<string>(
      entries.flatMap((entry) => normalize(entry.file).security.map((scheme) => scheme.type)),
    );

    // Then in both directions, which is what makes the second half a measurement rather than an
    // assumption: every type the corpus writes is read, and the five it never writes are read
    // from the specification's table alone rather than from any document here.
    expect([...produced].sort()).toEqual([...TYPES_IN_CORPUS].sort());
    expect(THIRTEEN_TYPES.filter((type) => !produced.has(type)).sort()).toEqual(
      [
        'asymmetricEncryption',
        'gssapi',
        'scramSha512',
        'symmetricEncryption',
        'userPassword',
      ].sort(),
    );
  }, 300_000);

  it('should match the recorded report, which is where both field lists live with their counts', async () => {
    // Given, the columns are all deterministic. Wall clock is deliberately absent, for the reason
    // the HTTP corpus report gives: a committed timing churns on every machine and would train a
    // reader to accept the diff.
    const usage = new Map<EventFieldSubject, { documents: number; positions: number }>(
      EVENT_FIELD_SUBJECTS.map((subject) => [subject, { documents: 0, positions: 0 }]),
    );
    let channelCount = 0;
    let replyCount = 0;
    let boundToSeveral = 0;
    let boundToSeveralProtocols = 0;

    const rows = entries.map((entry) => {
      const inputBytes = Buffer.byteLength(sourceOf(entry.file), 'utf8');
      const document = normalize(entry.file);
      const outputBytes = canonicalize({ ...document, hash: '' }).length;

      const written = eventFieldUsage(parse(entry.file));
      for (const subject of EVENT_FIELD_SUBJECTS) {
        const entryUsage = usage.get(subject);
        if (entryUsage === undefined || written[subject] === 0) continue;
        entryUsage.documents += 1;
        entryUsage.positions += written[subject];
      }

      channelCount += document.nodes.size;
      replyCount += everyOperation(document).filter(
        (operation) => operation.reply !== undefined,
      ).length;
      for (const channel of everyChannel(document)) {
        if (channel.servers.length < 2) continue;
        boundToSeveral += 1;
        if (channel.protocol === undefined) boundToSeveralProtocols += 1;
      }

      return [
        entry.file,
        editionOf(entry.file),
        protocolsOf(document).join(' ') || '(none)',
        String(inputBytes),
        String(outputBytes),
        String(document.nodes.size),
        String(everyOperation(document).length),
        String(document.schemas.size),
      ];
    });

    // The walk has to be able to find something before its silence about anything means anything.
    expect(channelCount).toBeGreaterThan(60);
    expect(replyCount).toBeGreaterThan(0);

    // When
    const header = [
      'document',
      'edition',
      'protocols',
      'source bytes',
      'IR bytes',
      'channels',
      'operations',
      'schemas',
    ];
    const table = [header, header.map(() => '---'), ...rows]
      .map((row) => `| ${row.join(' | ')} |`)
      .join('\n');

    const fieldRows = EVENT_FIELD_SUBJECTS.map((subject) => {
      const entryUsage = usage.get(subject);
      const carrier = Object.hasOwn(CARRIED, subject);
      const owner = SECURITY_MEMBERS.includes(subject) ? '`T051`' : '`T049`';
      return [
        `\`${subject}\``,
        String(entryUsage?.documents ?? 0),
        String(entryUsage?.positions ?? 0),
        carrier ? `carried, ${owner}` : 'NOT CARRIED, and nothing here says why',
      ];
    });
    const fieldHeader = ['member', 'documents writing it', 'positions', 'outcome'];
    const fieldTable = [fieldHeader, fieldHeader.map(() => '---'), ...fieldRows]
      .map((row) => `| ${row.join(' | ')} |`)
      .join('\n');

    // The scheme table counts produced schemes rather than written ones, deliberately: the
    // written side is asserted separately, and what a reader of this file wants to know is which
    // of the thirteen this corpus can be evidence about.
    const schemeCounts = new Map<string, { documents: number; schemes: number }>(
      THIRTEEN_TYPES.map((type) => [type, { documents: 0, schemes: 0 }]),
    );
    for (const entry of entries) {
      const seen = new Set<string>();
      for (const scheme of normalize(entry.file).security) {
        const row = schemeCounts.get(scheme.type);
        if (row === undefined) continue;
        row.schemes += 1;
        if (!seen.has(scheme.type)) {
          row.documents += 1;
          seen.add(scheme.type);
        }
      }
    }
    const schemeHeader = ['type', 'documents declaring one', 'schemes'];
    const schemeTable = [
      schemeHeader,
      schemeHeader.map(() => '---'),
      ...THIRTEEN_TYPES.map((type) => [
        `\`${type}\``,
        String(schemeCounts.get(type)?.documents ?? 0),
        String(schemeCounts.get(type)?.schemes ?? 0),
      ]),
    ]
      .map((row) => `| ${row.join(' | ')} |`)
      .join('\n');

    const licenses = [...new Set(entries.map((entry) => entry.license))].sort();

    const report = `# Event corpus

Generated by \`events-corpus-snapshot.spec.ts\`. Every column is deterministic, so a change here
is a change in what normalization produces rather than in the machine that ran it.

${String(entries.length)} documents, licensed ${licenses.join(' and ')}. Attribution is in the \`NOTICE\`
beside them and in \`manifest.json\`, which the \`fixture-licenses\` gate holds to each other and to
the bytes on disk.

## How this corpus was chosen, so the measurement below is not the choosing

The list is two rules rather than a selection, because the counts in the second table decided a
public type and a corpus picked document by document could have decided it either way.

- **Every AsyncAPI 3 document the AsyncAPI Initiative publishes as a flat file in \`examples/\` of
  \`asyncapi/spec\`.** All of them, with no choosing inside the set. The \`social-media\` sub tree
  is the one exclusion and it is structural: it is one example split across files that reference
  each other, and SPEC 8.2 refuses a structural reference that leaves its document.
- **Four documents written by four other parties, one each.** Every Initiative example on
  \`master\` declares 3.1.0, so a corpus of them alone proves nothing about 3.0.0, which SPEC 8.1
  also accepts, and all four of these declare 3.0.0. Three describe an API that exists: EVerest's
  system module, the Network Survey messaging API, and TransferGo's remittance bus, the last of
  which is published inside the Initiative's website repository as a case study and is TransferGo's
  document rather than the Initiative's. The fourth, Scalar's, is a product fixture and is the one
  document here that declares three protocols at once.

Three candidates were refused and are recorded here rather than dropped, because a corpus that
lists only what it kept is a corpus whose selection cannot be checked:

- **HDI, from the same case studies as TransferGo.** Not valid YAML: a flow mapping at line 55 is
  under indented, so the parser refuses the file before any of this is reached.
- **Kalshi's market data WebSocket API.** Refused by the normalizer, correctly.
  \`multivariateMarketLifecyclePayload\` is an \`allOf\` of a base whose \`type\` has
  \`const: market_lifecycle_v2\` and a branch whose \`type\` has
  \`const: multivariate_market_lifecycle\`. Under JSON Schema both must hold at once, so nothing
  satisfies it, and SPEC 5.4 is fail closed on exactly that. The author meant an override, which
  \`allOf\` is not.
- **EVerest's \`evse_manager_consumer_API\`.** Resolves schemas out of seven sibling files, and a
  structural reference is read inside its own document here. The same publisher's \`system_API\`
  resolves inside itself and is in the corpus instead.

## Normalization cost and coverage

${table}

## The six members that had no IR carrier at the close of \`T048\`

Measured by \`events-corpus-fields.ts\`, which reads the input documents rather than the IR and is
a second implementation of the reference resolution and the trait merge, so that the normalizer is
not the only witness to what its inputs say. A position is a produced server, a root operation, or
a message of a root channel; a definition sitting unreferenced in \`components\` is not counted,
because no page can reach it.

${fieldTable}

All six are carried, and the two dates are the two halves of one ruling. The four marked \`T049\`
were added on these counts as the minor half, an optional member on an interface obliging nobody.
The two marked \`T051\` are the breaking half: in AsyncAPI 3 both are lists of Security Scheme
Objects rather than lists of requirements naming a scheme table, so a carrier for either is a
reading of the thirteen scheme types, which is \`IRSecuritySchemeType\` growing from five names to
fourteen, recorded in \`ai-docs/design/CONTRACT.md\` beside \`IRDiffChangeKind\` and \`PageKind\`.
The counts above were re-measured on 2026-08-29 before that growth and had not moved.

## The thirteen security scheme types, and which of them this corpus reaches

${schemeTable}

Eight of the thirteen are written here and five are not. All thirteen are read anyway, because the
union is taken from the specification's own table whole: a partially read one is exactly the half
picture SPEC 8.2 spent \`T048\` and \`T049\` refusing. The five with no document behind them are
proved by \`asyncapi-normalizer.spec.ts\`, which declares one scheme of every type, and the corpus
states its own silence here rather than leaving it to be inferred from a shorter list.

## What this corpus does not exercise

The strongest evidence in this project states its own limit, which is the rule the HTTP corpus
report already follows. One SPEC 8.2 rule has no runner here and it is named rather than left to
be assumed: **a channel whose servers disagree about the protocol carries no protocol**.

Counted over the channels above: ${String(channelCount)} in total, ${String(boundToSeveral)} bound
to more than one server, ${String(boundToSeveralProtocols)} of those bound to servers that disagree
about the protocol. Every multi server channel here is on brokers that speak one protocol, so the
disagreement branch is proved only by the documents this repository wrote for itself, in
\`asyncapi-normalizer.spec.ts\`. Scalar's document declares three protocols and binds each of its
channels to one of them, so it does not close this gap either.
`;

    // Then
    await expect(report).toMatchFileSnapshot(join(CORPUS, 'report.md'));
  }, 300_000);
});
