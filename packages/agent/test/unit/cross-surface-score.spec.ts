import {
  buildHealthReport,
  healthScore,
  healthScoreMark,
  type IRDocument,
  type IRHealthCheck,
  type IRNode,
  type IROperation,
} from '@openref/core';
import { buildHealthModel } from '@openref/render';
import { describe, expect, it } from 'vitest';
import { agentHealthReport } from '../../src/mcp/domain/resources';
import { buildLlmsIndex } from '../../src/llms/domain/llms-text';

/**
 * ONE DOCUMENT, EVERY SURFACE, ONE STRING. This is the case the whole of host side suppression
 * turns on, and it is not a line in a list.
 *
 * THE DIVERGENCE IT CATCHES IS MECHANICAL AND NOT HYPOTHETICAL. `resources.ts` computes a linear
 * approximation over finding counts, `100 - (100 - score) * share`, while the health page renders
 * the weighted mean of SPEC 7.2 from the report. Under suppression those two differ by
 * construction: the mean is taken over checks whose totals were subtracted, and no function of the
 * finding counts can reproduce it. The last case below pins that gap open, so the assertion is
 * against the source of the number and not against a value that happens to match.
 *
 * WHAT MAKES IT REDDEN. Replace `report.score` in the MCP path with any locally computed figure
 * and the strings stop being equal. Format the score in either surface without going through
 * `healthScoreMark` and the parenthesis disappears from one of them. Both are the failure this
 * suite exists to see.
 */

/** The bare operation the fixtures start from. */
function operation(overrides: Partial<IROperation> = {}): IROperation {
  return {
    kind: 'operation',
    id: 'get-orders',
    method: 'get',
    path: '/orders',
    operationId: 'get-orders',
    tags: [],
    deprecated: false,
    parameters: [],
    responses: [],
    security: [],
    servers: [],
    ...overrides,
  };
}

/** A 200 response carrying a body, with or without a written example. */
function ok(withExample: boolean): IROperation['responses'][number] {
  return {
    statusCode: '200',
    description: 'ok',
    content: [
      {
        mediaType: 'application/json',
        schema: {
          kind: 'inline',
          schema: { id: 'body', dialect: 'json-schema-2020-12', normalized: { type: 'object' } },
        },
        ...(withExample ? { examples: { default: { value: { id: 1 } } } } : {}),
      },
    ],
    headers: [],
  };
}

/** A document holding the given nodes. */
function documentOf(nodes: readonly IRNode[]): IRDocument {
  return {
    id: 'orders',
    kind: 'http',
    hash: 'abc123',
    info: { title: 'Orders', version: '1.0.0' },
    servers: [],
    navigation: [],
    nodes: new Map(nodes.map((node) => [node.id, node])),
    schemas: new Map(),
    security: [],
    relationships: [],
    webhooks: new Map(),
  };
}

/**
 * A document with suppression active, and with no node marked `audience: internal`.
 *
 * THE ABSENCE OF AN INTERNAL NODE IS PART OF THE FIXTURE AND NOT AN OVERSIGHT. The audience filter
 * is a second reduction with a second purpose, and mixing it into this case would test two things
 * at once; it has its own case at the end.
 */
function suppressed(): IRDocument {
  const nodes = [
    operation({ id: 'a', path: '/a', summary: 'A', responses: [ok(false)] }),
    operation({ id: 'b', path: '/b', summary: 'B', responses: [ok(false)] }),
    operation({ id: 'c', path: '/c', summary: 'C', responses: [ok(true)] }),
  ];
  const document = documentOf(nodes);

  return {
    ...document,
    health: buildHealthReport(document, {
      suppress: [
        { rule: 'missing-example', reason: 'examples live in the client SDK repository' },
        {
          rule: 'missing-operation-id',
          reason: 'ids are generated and the team decided to keep them',
        },
      ],
    }),
  };
}

describe('the score every surface prints', () => {
  it('should hand the page and MCP one string on one document with suppression active', () => {
    // Given one document, suppressed, and nothing else different between the two readings
    const document = suppressed();

    // When each surface is asked for the percentage it shows a reader
    const page = buildHealthModel(document, '/docs')?.score;
    const mcp = agentHealthReport(document).scoreText;

    // Then THE STRINGS ARE IDENTICAL, not close. A page saying 88% beside an agent saying 92% is
    // one document answering two ways, and under suppression that is what an independently
    // computed number produces every time.
    expect(page).toBe(mcp);
    expect(page).toBe(healthScoreMark(document.health ?? { score: 0 }));
    expect(page).toMatch(/^\d+% \(\d+% unsuppressed\)$/);
  });

  it('should carry the suppressed count and the unsuppressed percentage to MCP', () => {
    // Given
    const document = suppressed();

    // When
    const report = agentHealthReport(document);

    // Then the figures reach the consumer from the report rather than being reconstructible from
    // it, which is the difference between an agent that can say what was hidden and one that
    // cannot tell a clean reference from a filtered one.
    expect(report.suppression?.unsuppressedScore).toBe(
      document.health?.suppression?.unsuppressedScore,
    );
    expect(report.suppression?.classes.map((entry) => entry.code)).toEqual(['DX020', 'DX030']);
    expect(report.suppressedFindings).toHaveLength(
      document.health?.suppression?.findings.length ?? -1,
    );
  });

  it('should carry the suppressed count and the unsuppressed percentage to llms.txt', () => {
    // Given
    const document = suppressed();
    const mark = healthScoreMark(document.health ?? { score: 0 });

    // When
    const text = buildLlmsIndex(document, {
      basePath: '/docs',
      agent: { llmsTxt: true, mcp: false },
    });

    // Then the one line an agent reads about health names both, in the same words the page uses
    expect(text).toContain(mark);
    expect(text).toContain('suppressed by 2 classes');
  });

  it('should say nothing about suppression in llms.txt when nothing was suppressed', () => {
    // Given the same document with no suppression at all
    const nodes = [operation({ id: 'a', path: '/a', summary: 'A', responses: [ok(false)] })];
    const bare = documentOf(nodes);
    const document: IRDocument = { ...bare, health: buildHealthReport(bare) };

    // When
    const text = buildLlmsIndex(document, {
      basePath: '/docs',
      agent: { llmsTxt: true, mcp: false },
    });

    // Then the artefact of a document nobody suppressed anything on does not move by one byte,
    // which is what keeps this addition free for every existing host.
    expect(text).not.toContain('suppressed');
    expect(text).toContain('- [Documentation Health report](/docs/health)\n');
  });

  it('should refuse to let MCP reach 100 as the primary while an error class is suppressed', () => {
    // Given a document whose only complaint is an error class, so suppressing it scores 100
    const nodes = [
      operation({
        id: 'a',
        path: '/a',
        operationId: 'listOrders',
        rawOperationId: 'listOrders',
        summary: 'List orders',
        responses: [ok(true)],
        runtime: {
          guards: [
            { name: 'JwtAuthGuard', scope: 'route', confidence: 'declared', collector: 'guards' },
          ],
        },
      }),
    ];
    const bare = documentOf(nodes);
    const document: IRDocument = {
      ...bare,
      health: buildHealthReport(bare, {
        suppress: [{ rule: 'security-drift', reason: 'authorisation is enforced by the gateway' }],
      }),
    };

    // When every surface is asked
    const page = buildHealthModel(document, '/docs')?.score;
    const report = agentHealthReport(document);
    const text = buildLlmsIndex(document, {
      basePath: '/docs',
      agent: { llmsTxt: true, mcp: false },
    });

    // Then. THE SUPPRESSED SCORE IS 100 AND NOWHERE IS IT THE PRIMARY. It is asserted present
    // first, because a proof that a number is absent is worth nothing until the number is shown
    // to exist.
    expect(document.health?.suppression?.suppressedScore).toBe(100);
    expect(report.score).toBeLessThan(100);
    expect(page).toBe(report.scoreText);
    expect(page).toMatch(/^\d+% \(100% suppressed\)$/);
    expect(page?.startsWith('100%')).toBe(false);
    expect(text).toContain(report.scoreText);
  });

  it('should keep the two surfaces together when the audience filter runs as well', () => {
    // Given a document with suppression AND an internal node, which is the one case where the
    // agent surface has a number of its own to state: the score of what it is allowed to show
    const nodes = [
      operation({ id: 'a', path: '/a', summary: 'A', responses: [ok(false)] }),
      operation({
        id: 'b',
        path: '/b',
        summary: 'B',
        responses: [ok(false)],
        extensions: { 'x-openref-audience': 'internal' },
      }),
    ];
    const bare = documentOf(nodes);
    const document: IRDocument = {
      ...bare,
      health: buildHealthReport(bare, {
        suppress: [{ rule: 'missing-example', reason: 'examples live in the SDK' }],
      }),
    };

    // When
    const report = agentHealthReport(document);

    // Then the marked string is rebuilt from THIS report's own primary rather than copied from
    // the document's, so the parenthesis and the number in front of it are about one thing.
    expect(report.withheldFindings).toBeGreaterThan(0);
    expect(report.scoreText.startsWith(`${String(report.score)}%`)).toBe(true);
    expect(report.scoreText).toBe(healthScoreMark(report));
  });

  it('should differ from the linear approximation over finding counts, which is the point', () => {
    // Given the maintainer's own check profile, 58 operations and 180 findings, of which 111 are
    // the two classes he decided not to fix
    const checks: readonly IRHealthCheck[] = [
      { id: 'missing-operation-id', label: 'ids', passed: 0, total: 58, severity: 'warning' },
      { id: 'missing-example', label: 'examples', passed: 5, total: 58, severity: 'info' },
      { id: 'missing-description', label: 'summaries', passed: 58, total: 58, severity: 'warning' },
      { id: 'security-drift', label: 'security', passed: 22, total: 26, severity: 'error' },
      { id: 'scope-drift', label: 'scopes', passed: 28, total: 29, severity: 'warning' },
      { id: 'stream-unspecified', label: 'streams', passed: 45, total: 52, severity: 'error' },
      { id: 'parameter-unread', label: 'parameters', passed: 45, total: 57, severity: 'warning' },
      {
        id: 'header-requiredness-drift',
        label: 'headers',
        passed: 23,
        total: 24,
        severity: 'warning',
      },
      { id: 'status-drift', label: 'statuses', passed: 53, total: 56, severity: 'error' },
      { id: 'dto-field-undescribed', label: 'fields', passed: 432, total: 466, severity: 'info' },
      { id: 'discovery-incomplete', label: 'discovery', passed: 0, total: 7, severity: 'warning' },
      { id: 'runtime-collectors', label: 'collectors', passed: 4, total: 5, severity: 'warning' },
    ];

    // When the weighted mean of SPEC 7.2 is taken over the checks with the two classes subtracted,
    // and the linear approximation is taken over the finding counts instead: 180 findings become
    // 69, so the share is 69/180 and the deficit shrinks with it
    const unsuppressed = healthScore(checks);
    const suppressed = healthScore(
      checks.map((check) => {
        if (check.id === 'missing-operation-id') return { ...check, passed: 0, total: 0 };
        if (check.id === 'missing-example') return { ...check, passed: 5, total: 5 };

        return check;
      }),
    );
    const approximation = Math.round(100 - (100 - unsuppressed) * (69 / 180));

    // Then THE TWO DISAGREE BY THREE POINTS ON HIS OWN DOCUMENT, and that gap is exactly what a
    // second surface computing its own number would print beside the page. The approximation is
    // asserted to exist and to be wrong here so that the equality cases above are equalities about
    // the source of the number and not coincidences that happen to line up.
    expect(unsuppressed).toBe(77);
    expect(suppressed).toBe(88);
    expect(approximation).toBe(91);
    expect(approximation).not.toBe(suppressed);
  });
});
