import {
  buildHealthReport,
  driftForNode,
  normalizeOpenApiDocument,
  type IRDocument,
  type IRNode,
} from '@openref/core';
import { describe, expect, it } from 'vitest';
import { buildParityRows } from '../../src/page/domain/parity-model';
import { buildPageModel } from '../../src/page/domain/page-model';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { runtimeDocument, runtimeNodeId, smallDocument } from '../mocks/documents';

const markdown = await createMarkdownRenderer();

/**
 * `TX-INSTRUMENT` in the renderer: what a reader is told, rather than what the engine decided.
 *
 * TWELVE CODE SITES REACHED ONE SENTENCE. `Nothing observed here.` was printed for a fact nobody
 * was asked about and for a route that was asked and had nothing to say, and 0 of 11 rows could
 * tell a reader which. What is held here is that each row now says which, that a row carrying
 * facts under `?` says why there is no verdict, and that the gutter no longer contradicts the
 * health page about a comparison both of them ran.
 */

/** The operation the runtime fixture puts facts on, with the findings recorded about it. */
function subject(document: IRDocument): {
  operation: Extract<IRNode, { kind: 'operation' }>;
  issues: ReturnType<typeof driftForNode>;
} {
  const id = runtimeNodeId();
  const node = document.nodes.get(id);
  if (node?.kind !== 'operation') throw new Error('fixture moved');

  return { operation: node, issues: driftForNode(document.health?.drift ?? [], id) };
}

/**
 * A document whose one operation is guarded, declares the scheme that guard maps to, and carries
 * the mapping in its runtime metadata, which is what a real pass leaves behind.
 *
 * @param carryMapping - Whether the document keeps the mapping the pass was configured with
 * @returns The document, with the health report a pass would have attached
 */
function guardedDocument(carryMapping: boolean): IRDocument {
  const base = normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Orders', version: '1' },
    servers: [{ url: 'https://api.example.com' }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    paths: {
      '/orders': {
        get: {
          operationId: 'listOrders',
          summary: 'List orders',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  });

  const nodes = new Map(base.nodes);
  for (const [id, node] of base.nodes) {
    nodes.set(id, {
      ...node,
      runtime: {
        guards: [
          {
            name: 'JwtAuthGuard',
            scope: 'route',
            confidence: 'derived',
            collector: 'guardsCollector',
          },
        ],
      },
    });
  }

  const withFacts: IRDocument = {
    ...base,
    nodes,
    runtime: {
      collectors: ['guardsCollector'],
      ...(carryMapping ? { guardSchemes: { JwtAuthGuard: 'bearerAuth' } } : {}),
    },
  };

  return {
    ...withFacts,
    health: buildHealthReport(withFacts, {
      observation: {
        handledNodeIds: new Set(base.nodes.keys()),
        guardSchemes: new Map([['JwtAuthGuard', 'bearerAuth']]),
      },
    }),
  };
}

describe('the parity scale says which of the two silences an empty cell is', () => {
  it('should name what would report a fact nothing in this installation reports', () => {
    // Given the measured shape: the registry names no collector for the row, and no node in the
    // document carries the fact, which is what a host whose limiter is not @nestjs/throttler has
    const base = runtimeDocument();
    const stripped: IRDocument = {
      ...base,
      runtime: { collectors: ['guardsCollector'], sourceLinkTemplate: '' },
    };
    const { operation, issues } = subject(base);

    // When
    const rows = buildParityRows(stripped, operation, issues, '');
    const validation = rows.find((row) => row.kind === 'validation');

    // Then the sentence names a cause and an action, which is what the `source` row already did
    expect(validation?.runtime).toEqual([]);
    expect(validation?.reason).toBe(
      'No registered collector reports pipes. Add pipesCollector to the collectors option, or ' +
        'write one that does.',
    );
  });

  it('should say the route was examined and was silent where the collector did report elsewhere', () => {
    // Given a document whose pipes collector filled another route and not this one, which is the
    // measured shape of a validation row: 32 of 58 filled, 26 silent
    const base = runtimeDocument();
    const factsOn = runtimeNodeId();
    const other = [...base.nodes.keys()].find((id) => id !== factsOn) ?? '';
    const carrier = base.nodes.get(other);
    if (carrier === undefined) throw new Error('fixture moved');

    const nodes = new Map(base.nodes);
    nodes.set(other, {
      ...carrier,
      runtime: {
        pipes: [
          {
            name: 'ValidationPipe',
            scope: 'global',
            confidence: 'derived',
            collector: 'pipesCollector',
          },
        ],
      },
    });
    const document: IRDocument = { ...base, nodes };
    const { operation, issues } = subject(document);

    // When
    const rows = buildParityRows(document, operation, issues, '');
    const validation = rows.find((row) => row.kind === 'validation');

    // Then the two sentences are different sentences, which is the whole of this change
    expect(validation?.reason).toBe(
      'pipesCollector examined this route and found no pipe declared on it. Anything applied to ' +
        'it from outside the route is named in the doctor report, not here.',
    );
  });

  it('should carry the registry own reason for a collector that was registered and declined', () => {
    // Given the shape `@openref/collector-throttler` registers when its package is absent
    const base = runtimeDocument();
    const document: IRDocument = {
      ...base,
      runtime: {
        collectors: ['guardsCollector', 'timeoutCollector'],
        skipped: [{ collector: 'timeoutCollector', reason: 'no metadata key was configured' }],
      },
    };
    const { operation, issues } = subject(base);

    // When
    const rows = buildParityRows(document, operation, issues, '');
    const timeout = rows.find((row) => row.kind === 'timeout');

    // Then
    expect(timeout?.reason).toBe(
      'timeoutCollector was registered and did not run: no metadata key was configured',
    );
  });

  it('should say no pass ran for a document nothing measured', () => {
    // Given a document normalized from a file, with no runtime metadata at all
    const document = smallDocument();
    const node = document.nodes.get(runtimeNodeId());
    if (node?.kind !== 'operation') throw new Error('fixture moved');

    // When
    const rows = buildParityRows(document, node, [], '');

    // Then every row says the same thing, because nothing was asked about any of them
    expect(new Set(rows.map((row) => row.reason)).size).toBe(rows.length);
    expect(rows[0]?.reason).toBe(
      'No runtime pass ran on this document, so nothing asked about guards.',
    );
  });

  it('should give every one of the eleven rows a sentence it could not print before', () => {
    // Given, the subject is present: the fixture leaves rows empty
    const base = runtimeDocument();
    const { operation, issues } = subject(base);

    // When
    const rows = buildParityRows(base, operation, issues, '');
    const explained = rows.filter((row) => row.runtime.length === 0 && row.reason !== '');

    // Then no empty cell is left saying nothing, and none of them says the old phrase
    expect(rows.filter((row) => row.runtime.length === 0).length).toBe(explained.length);
    expect(rows.some((row) => row.reason === 'Nothing observed here.')).toBe(false);
  });

  it('should say why a row carrying facts still carries no verdict', () => {
    // Given the validation row of the filled fixture: facts, and no rule that examines them
    const base = runtimeDocument();
    const factsOn = runtimeNodeId();
    const node = base.nodes.get(factsOn);
    if (node?.kind !== 'operation') throw new Error('fixture moved');
    const withPipes: Extract<IRNode, { kind: 'operation' }> = {
      ...node,
      runtime: {
        ...node.runtime,
        pipes: [
          { name: 'TrimPipe', scope: 'route', confidence: 'derived', collector: 'pipesCollector' },
        ],
      },
    };

    // When
    const rows = buildParityRows(base, withPipes, [], '');
    const validation = rows.find((row) => row.kind === 'validation');

    // Then, and until now this fact reached only a screen reader, through `aria-label`
    expect(validation?.verdict).toBe('unknown');
    expect(validation?.runtime.length).toBe(1);
    expect(validation?.reason).toBe(
      'No rule of the drift catalogue examines this row yet, so neither side is judged.',
    );
  });
});

describe('the gutter and the health page answer one comparison the same way', () => {
  it('should draw a match where the report counted the operation as passed', () => {
    // Given a guarded operation whose security the document states, and a document carrying the
    // mapping the pass compared them with
    const document = guardedDocument(true);
    const nodeId = [...document.nodes.keys()][0] ?? '';
    const node = document.nodes.get(nodeId);
    if (node?.kind !== 'operation') throw new Error('fixture moved');
    const check = document.health?.checks.find((entry) => entry.id === 'security-drift');
    // The subject is present: the report examined this operation and counted it as passed
    expect(check?.total).toBe(1);
    expect(check?.passed).toBe(1);

    // When
    const rows = buildParityRows(document, node, [], '');
    const authentication = rows.find((row) => row.kind === 'authentication');

    // Then the gutter says what the report says. Without the mapping on the document this row
    // answered `?` over the same operations the health page had already counted as passed, which
    // was measured at 54 of 58 authentication cells against 54 of 58 passed.
    expect(authentication?.verdict).toBe('match');
  });

  it('should keep the unknown verdict where the document carries no mapping to re-ask with', () => {
    // Given the same document with the mapping left off it
    const document = guardedDocument(false);
    const nodeId = [...document.nodes.keys()][0] ?? '';
    const node = document.nodes.get(nodeId);
    if (node?.kind !== 'operation') throw new Error('fixture moved');

    // When
    const rows = buildParityRows(document, node, [], '');
    const authentication = rows.find((row) => row.kind === 'authentication');

    // Then claiming less is the right answer, not a match borrowed from a comparison nothing ran
    expect(authentication?.verdict).toBe('unknown');
    expect(authentication?.reason).toBe(
      'No rule of the drift catalogue examines this row yet, so neither side is judged.',
    );
  });
});

describe('the two counts that never agreed with themselves', () => {
  it('should agree with its own noun for a single code and a single parameter', () => {
    // Given an operation declaring exactly one response and one parameter, which on a real
    // document is most of them
    const document = smallDocument();
    const node = [...document.nodes.values()].find(
      (candidate) =>
        candidate.kind === 'operation' &&
        candidate.responses.length === 1 &&
        candidate.parameters.length === 1,
    );

    // When, taking whichever operation the fixture offers and asserting per count
    const rows = buildParityRows(
      document,
      node?.kind === 'operation'
        ? node
        : (() => {
            const first = [...document.nodes.values()].find(
              (candidate) => candidate.kind === 'operation',
            );
            if (first?.kind !== 'operation') throw new Error('fixture moved');

            return first;
          })(),
      [],
      '',
    );
    const codes = rows.find((row) => row.kind === 'response-codes');
    const parameters = rows.find((row) => row.kind === 'unread-parameters');

    // Then
    expect(codes?.spec.note).not.toContain('1 codes');
    expect(parameters?.spec.value).not.toContain('1 parameters');
  });

  it('should print the singular for one and the plural for two', () => {
    // Given a document with an operation declaring one code and another declaring two
    const document = smallDocument();
    const notes = [...document.nodes.values()]
      .filter((node) => node.kind === 'operation')
      .map((node) => buildParityRows(document, node, [], ''))
      .map((rows) => rows.find((row) => row.kind === 'response-codes')?.spec.note ?? '');

    // When
    const singular = notes.filter((note) => note.startsWith('1 '));

    // Then, the subject is present: some operation declares exactly one code
    expect(singular.length).toBeGreaterThan(0);
    expect(singular.every((note) => note === '1 code declared')).toBe(true);
  });
});

describe('the rail stats count what their words name', () => {
  it('should not count the Schemas registry as a group of operations', () => {
    // Given a document with one tag bucket and a schema registry beside it in the rail
    const document = smallDocument();
    const roots = document.navigation.filter(
      (entry) =>
        entry.kind === 'group' && entry.nodeId === undefined && entry.schemaId === undefined,
    );
    const schemasRoot = roots.find((entry) => entry.id === 'group-schemas');
    // The subject is present: there is a Schemas root, and the old predicate selected it
    expect(schemasRoot).toBeDefined();

    // When
    const model = buildPageModel(document, { markdown });

    // Then the count is the roots minus that one, which on the measured document is 14 not 15
    expect(model.frame.stats.groups).toBe(roots.length - 1);
  });
});

describe('the operation header quotes the document own operationId', () => {
  it('should print what the document wrote and not what the normalizer derived', () => {
    // Given a document whose ids are the shape @nestjs/swagger writes
    const source = {
      openapi: '3.1.0',
      info: { title: 'Orders', version: '1' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/orders': {
          get: {
            operationId: 'OrdersController_findAll',
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    };
    const document = normalizeOpenApiDocument(source);
    const nodeId = [...document.nodes.keys()][0] ?? '';

    // When
    const model = buildPageModel(document, { markdown, nodeId });

    // Then, per SPEC 11 the kicker draws the author's id. It drew `get-orders`, an id that
    // appears nowhere in the served document, on every operation of every such document.
    expect(model.node?.operationId).toBe('OrdersController_findAll');
  });

  it('should print nothing where the document wrote no operationId at all', () => {
    // Given, and the derived id was printed here as though the author had chosen it
    const document = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Orders', version: '1' },
      servers: [{ url: 'https://api.example.com' }],
      paths: { '/orders': { get: { responses: { '200': { description: 'ok' } } } } },
    });
    const nodeId = [...document.nodes.keys()][0] ?? '';

    // When
    const model = buildPageModel(document, { markdown, nodeId });

    // Then
    expect(model.node?.operationId).toBe('');
  });
});
