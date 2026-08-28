import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDoctorReport, buildHealthReport } from '@openref/core';
import { applyFixes } from '../../src/cli/application/services/fix.service';
import { planFixes } from '../../src/cli/domain/fix-plan';
import type { DriftObservation, IRDocument, IRNode, IROperation } from '@openref/core';

/**
 * The two nodes the per finding classification exists for, driven end to end through `--fix`.
 *
 * THESE ARE THE CASES A TABLE FROM RULE ID TO BUCKET WOULD HAVE GOT WRONG, and getting them wrong
 * means writing a second assertion into source beside one that already says something different.
 * `ratelimit-undocumented` on an operation that documents 429 with a disagreeing limit, and
 * `security-drift` on an operation already carrying a scheme other than the one its guard maps to,
 * both reach a fix run under a rule whose other state is a silence, and both have to come out
 * untouched.
 *
 * THE WHOLE CHAIN IS REAL AND NOT MOCKED AT THE SEAM. The rules of `@openref/core` produce the
 * findings, `buildDoctorReport` joins them, the planner reads the classification off them and the
 * rewriter opens a source file that is really on disk. A test that handed the planner a hand
 * written classification would prove the planner agrees with the test rather than with T022.
 */

const CONTROLLER = [
  "import { Controller, Get, Post } from '@nestjs/common';",
  "import { ApiResponse, ApiSecurity } from '@nestjs/swagger';",
  '',
  "@Controller('orders')",
  'export class OrdersController {',
  '  @ApiResponse({ status: 429 })',
  '  @Get()',
  '  list(): string[] {',
  "    return ['ord_1'];",
  '  }',
  '',
  "  @ApiSecurity('basic')",
  '  @Post()',
  '  create(): string {',
  "    return 'ord_2';",
  '  }',
  '}',
  '',
].join('\n');

const FILE = 'src/orders.controller.ts';

let root = '';

/** The operation that documents a 429 whose limit disagrees with the throttler. */
function documentedButDisagreeing(): IROperation {
  return {
    kind: 'operation',
    id: 'list',
    method: 'get',
    path: '/orders',
    operationId: 'list',
    // NAMED SO THAT `missing-operation-id` STAYS QUIET. Without it that rule fires as a silence
    // on both operations and this suite would be asserting about three findings while claiming to
    // assert about two.
    rawOperationId: 'listOrders',
    tags: [],
    deprecated: false,
    parameters: [],
    responses: [
      {
        statusCode: '429',
        headers: [
          {
            name: 'RateLimit-Limit',
            required: true,
            // THE ONLY MACHINE READABLE STATEMENT OPENAPI HAS ABOUT A LIMIT, per SPEC 7.1: a
            // numeric `const` on this header's schema. Five, against the ten the throttler
            // enforces, is what makes this operation a contradiction rather than a silence.
            schema: {
              kind: 'inline',
              schema: {
                id: 'limit',
                dialect: 'json-schema-2020-12',
                normalized: { type: 'integer', const: 5 },
              },
            },
          },
        ],
        content: [],
      },
    ],
    security: [],
    servers: [],
    runtime: {
      source: { controller: 'OrdersController', handler: 'list', file: FILE },
      rateLimit: {
        value: { limit: 10, ttlMs: 60_000 },
        confidence: 'derived',
        collector: 'throttlerCollector',
      },
    },
  };
}

/** The operation already asserting a scheme other than the one its guard maps to. */
function assertingAnotherScheme(): IROperation {
  return {
    kind: 'operation',
    id: 'create',
    method: 'post',
    path: '/orders',
    operationId: 'create',
    rawOperationId: 'createOrder',
    tags: [],
    deprecated: false,
    parameters: [],
    responses: [],
    security: [{ schemeId: 'basic', scopes: [] }],
    servers: [],
    runtime: {
      source: { controller: 'OrdersController', handler: 'create', file: FILE },
      guards: [
        { name: 'JwtGuard', scope: 'route', confidence: 'derived', collector: 'guardsCollector' },
      ],
    },
  };
}

/**
 * The document both operations live in, with the health a runtime pass would have computed.
 *
 * THE OBSERVATION IS ATTACHED RATHER THAN LEFT OFF, because without one every runtime rule is out
 * of scope and this suite would pass by asking no question at all.
 */
function documentWithBoth(): IRDocument {
  const nodes: readonly IRNode[] = [documentedButDisagreeing(), assertingAnotherScheme()];
  const base: IRDocument = {
    id: 'orders',
    kind: 'http',
    hash: '',
    info: { title: 'Orders', version: '1.0.0' },
    servers: [],
    navigation: [],
    nodes: new Map(nodes.map((node) => [node.id, node])),
    schemas: new Map(),
    security: [],
    relationships: [],
    webhooks: new Map(),
  };

  const observation: DriftObservation = {
    handledNodeIds: new Set(base.nodes.keys()),
    guardSchemes: new Map([['JwtGuard', 'bearer']]),
  };

  return { ...base, health: buildHealthReport(base, { observation }) };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openref-contradiction-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, FILE), CONTROLLER, 'utf8');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('a fix run over the two contradictions a rule name would have called silence', () => {
  it('should classify both as contradictions rather than as the silence their rule also produces', () => {
    // Given
    const report = buildDoctorReport(documentWithBoth());

    // When
    const both = report.findings.filter((finding) =>
      ['ratelimit-undocumented', 'security-drift'].includes(finding.rule),
    );

    // Then
    expect(both.map((finding) => finding.rule)).toEqual([
      'ratelimit-undocumented',
      'security-drift',
    ]);
    expect(both.every((finding) => finding.classification.bucket === 'contradiction')).toBe(true);
    expect(both.every((finding) => finding.assertion === undefined)).toBe(true);
  });

  it('should leave the source byte identical and name each one as a contradiction', async () => {
    // Given
    const report = buildDoctorReport(documentWithBoth());

    // When
    const run = await applyFixes(planFixes(report), { root, write: true });
    const after = await readFile(join(root, FILE), 'utf8');

    // Then
    expect(run.applied).toHaveLength(0);
    expect(
      run.left.filter((entry) => entry.reason === 'contradiction').map((entry) => entry.rule),
    ).toEqual(['ratelimit-undocumented', 'security-drift']);
    expect(after).toBe(CONTROLLER);
  });
});
