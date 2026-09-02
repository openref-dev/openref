import { describe, expect, it } from 'vitest';
import {
  buildDoctorReport,
  normalizeOpenApiDocument,
  type IRDoctorFinding,
  type IRDoctorReport,
  type IRDocument,
} from '@openref/core';
import {
  renderDoctorFinding,
  renderDoctorFindings,
  renderDoctorSummary,
} from '../../src/cli/api/commands/doctor-report-text';

/** A minimal, otherwise clean report, so each test overrides only what it is about. */
function report(overrides: Partial<IRDoctorReport> = {}): IRDoctorReport {
  return { version: 1, score: 100, operationCount: 1, checks: [], findings: [], ...overrides };
}

/** A minimal finding, so each test overrides only what it is about. */
function finding(overrides: Partial<IRDoctorFinding> = {}): IRDoctorFinding {
  return {
    rule: 'security-drift',
    code: 'RT010',
    severity: 'error',
    classification: { bucket: 'silence' },
    subject: 'POST /users',
    message: 'A guard stands on this operation and the specification asserts no security.',
    suggestion: 'add @ApiBearerAuth() or declare security in DocumentBuilder',
    ...overrides,
  };
}

describe('renderDoctorSummary', () => {
  it('should print the title, health percentage and operation count', () => {
    // Given
    const built = report({ score: 87, operationCount: 127 });

    // When
    const text = renderDoctorSummary(built, 'Orders 1.0.0');

    // Then
    expect(text).toBe('Orders 1.0.0\n\nDocumentation health: 87%\n127 operations');
  });

  it('should say one operation in the singular', () => {
    // Given / When
    const text = renderDoctorSummary(report({ operationCount: 1 }), 'Mini 1.0.0');

    // Then
    expect(text.endsWith('1 operation')).toBe(true);
  });

  it('should mark a fully clean check with a checkmark and the pass count', () => {
    // Given
    const built = report({
      checks: [
        {
          id: 'missing-description',
          label: 'Operations with a description',
          passed: 5,
          total: 5,
          severity: 'warning',
        },
      ],
    });

    // When
    const text = renderDoctorSummary(built, 'Orders 1.0.0');

    // Then
    expect(text).toContain('✓ 5/5  Operations with a description');
  });

  it('should mark a warning severity check with a failure with a warning triangle', () => {
    // Given
    const built = report({
      checks: [
        {
          id: 'missing-description',
          label: 'Operations with a description',
          passed: 3,
          total: 5,
          severity: 'warning',
        },
      ],
    });

    // When
    const text = renderDoctorSummary(built, 'Orders 1.0.0');

    // Then
    expect(text).toContain('⚠ 3/5  Operations with a description');
  });

  it('should mark an error severity check with a failure with a cross', () => {
    // Given
    const built = report({
      checks: [
        {
          id: 'stream-unspecified',
          label: 'Streaming operations with an item schema',
          passed: 0,
          total: 2,
          severity: 'error',
        },
      ],
    });

    // When
    const text = renderDoctorSummary(built, 'Orders 1.0.0');

    // Then
    expect(text).toContain('✗ 0/2  Streaming operations with an item schema');
  });

  it('should draw no line for a check with nothing in scope', () => {
    // Given
    const built = report({
      checks: [
        {
          id: 'stream-unspecified',
          label: 'Streaming operations with an item schema',
          passed: 0,
          total: 0,
          severity: 'error',
        },
        {
          id: 'missing-description',
          label: 'Operations with a description',
          passed: 1,
          total: 1,
          severity: 'warning',
        },
      ],
    });

    // When
    const text = renderDoctorSummary(built, 'Orders 1.0.0');

    // Then
    expect(text).not.toContain('Streaming operations');
    expect(text).toContain('Operations with a description');
  });

  it('should print no check lines at all when every check has nothing in scope', () => {
    // Given
    const built = report({
      checks: [
        { id: 'stream-unspecified', label: 'Streaming', passed: 0, total: 0, severity: 'error' },
      ],
    });

    // When
    const text = renderDoctorSummary(built, 'Orders 1.0.0');

    // Then
    expect(text).toBe('Orders 1.0.0\n\nDocumentation health: 100%\n1 operation');
  });
});

describe('renderDoctorFinding', () => {
  it('should print the code and subject on the header line', () => {
    // Given / When
    const text = renderDoctorFinding(finding());

    // Then
    expect(text.split('\n')[0]).toBe('DRIFT  RT010  POST /users');
  });

  it('should print the runtime and spec values when present', () => {
    // Given
    const built = finding({
      runtimeValue: 'JwtAuthGuard, RolesGuard',
      specValue: 'security: undefined',
    });

    // When
    const text = renderDoctorFinding(built);

    // Then
    expect(text).toContain('  Runtime:  JwtAuthGuard, RolesGuard');
    expect(text).toContain('  OpenAPI:  security: undefined');
  });

  it('should omit the runtime and spec lines when neither is present', () => {
    // Given / When
    const text = renderDoctorFinding(finding());

    // Then
    expect(text).not.toContain('Runtime:');
    expect(text).not.toContain('OpenAPI:');
  });

  it('should always print the suggestion with an arrow', () => {
    // Given / When
    const text = renderDoctorFinding(finding({ suggestion: 'add @ApiBearerAuth()' }));

    // Then
    expect(text).toContain('  →  add @ApiBearerAuth()');
  });

  it('should print the resolved link when the source expanded to one', () => {
    // Given
    const built = finding({
      source: { controller: 'OrdersController', handler: 'list', file: 'orders.ts', line: 12 },
      sourceLink: { url: 'https://example.test/orders.ts#L12' },
    });

    // When
    const text = renderDoctorFinding(built);

    // Then
    expect(text).toContain(
      '  Source:   OrdersController.list()  https://example.test/orders.ts#L12',
    );
  });

  it('should fall back to file and line when there is no resolved link', () => {
    // Given
    const built = finding({
      source: { controller: 'OrdersController', handler: 'list', file: 'orders.ts', line: 12 },
      sourceLink: { reason: 'no source link template is configured' },
    });

    // When
    const text = renderDoctorFinding(built);

    // Then
    expect(text).toContain('  Source:   OrdersController.list()  orders.ts:12');
  });

  it('should fall back to the class and method when there is no file at all', () => {
    // Given
    const built = finding({ source: { controller: 'OrdersController', handler: 'list' } });

    // When
    const text = renderDoctorFinding(built);

    // Then
    expect(text).toContain('  Source:   OrdersController.list()');
    expect(text).not.toContain('undefined');
  });

  it('should print no source line at all for a finding with no source location', () => {
    // Given / When
    const text = renderDoctorFinding(finding());

    // Then
    expect(text).not.toContain('Source:');
  });
});

describe('renderDoctorSummary, the collectors that did not run', () => {
  it('should print the reason each skipped collector gave, which nothing did before T054', () => {
    // Given a report and the skipped list `IRRuntimeMeta.skipped` carries. That member has said
    // "for `doctor` to report" since `T017` and had no reader anywhere: the `runtime-collectors`
    // check printed a count and the reason the missing one did not run was in the document and on
    // no page.
    const built = report({ score: 87, operationCount: 12 });

    // When
    const text = renderDoctorSummary(built, 'Orders 1.0.0', [
      { collector: 'throttlerCollector', reason: '@nestjs/throttler is not installed' },
      { collector: 'headersCollector', reason: 'it threw on the third node' },
    ]);

    // Then both are named with their reasons, under a heading that says what they are. They are
    // deliberately not findings, per SPEC 7.1: a collector that could not run is the instrument
    // failing rather than the two sides differing, and it is already counted by its own check.
    expect(text).toContain('Collectors that did not run:');
    expect(text).toContain('throttlerCollector: @nestjs/throttler is not installed');
    expect(text).toContain('headersCollector: it threw on the third node');
    expect(text).not.toContain('DRIFT');
  });

  it('should print no such block when every collector ran, which is the control', () => {
    // Given / When / Then. Without this the case above could not tell a heading that is always
    // printed from one that answers the document.
    expect(
      renderDoctorSummary(report({ score: 100, operationCount: 1 }), 'Orders 1.0.0'),
    ).not.toContain('Collectors that did not run');
  });
});

describe('renderDoctorFindings', () => {
  it('should separate blocks with a blank line', () => {
    // Given
    const findings = [finding({ subject: 'POST /users' }), finding({ subject: 'GET /users' })];

    // When
    const text = renderDoctorFindings(findings);

    // Then
    expect(text).toBe(
      `${renderDoctorFinding(findings[0]!)}\n\n${renderDoctorFinding(findings[1]!)}`,
    );
  });

  it('should print nothing for no findings', () => {
    // Given / When / Then
    expect(renderDoctorFindings([])).toBe('');
  });
});

/**
 * What a reader of the terminal can tell about where an unread key is, per the `T065` section.
 *
 * DRIVEN THROUGH THE REAL NORMALIZER AND THE REAL RULE, not through a hand written finding.
 * The defect was that `unreadKeyResult` called `issueOf` with an empty subject, so `findingSubject`
 * fell through to the literal `(document)` while the whole address sat in `message`, which this
 * renderer does not read: measured before the fix on a document carrying a wrong case key under a
 * path and another under a webhook, both blocks headed `DRIFT  DX050  (document)`.
 */
describe('a DX050 finding, at each of the four positions an unread key can hang off', () => {
  /** One document that carries all four, so the case cannot pass by covering one. */
  function unreadKeyDocument(): IRDocument {
    return normalizeOpenApiDocument({
      openapi: '3.2.0',
      info: { title: 'Unread', version: '1' },
      paths: {
        '/a': {
          GET: { responses: { '200': { description: 'ok' } } },
          get: {
            responses: { '200': { description: 'ok' } },
            callbacks: {
              onEvent: {
                '{$request.body#/url}': { PUT: { responses: { '200': { description: 'ok' } } } },
              },
            },
          },
          additionalOperations: { get: { responses: { '200': { description: 'ok' } } } },
        },
      },
      webhooks: { onOrder: { POST: { responses: { '200': { description: 'ok' } } } } },
    });
  }

  it('should carry all four positions, so nothing below passes on a document with one', () => {
    // Given / When
    const positions = (unreadKeyDocument().unreadKeys ?? []).map((key) => key.position);

    // Then
    expect([...new Set(positions)].sort()).toEqual([
      'additional-operations',
      'callback',
      'paths',
      'webhooks',
    ]);
  });

  it('should head every block with the member the key hangs off, never with (document)', () => {
    // Given
    const document = unreadKeyDocument();
    const findings = buildDoctorReport(document).findings.filter((entry) => entry.code === 'DX050');

    // When
    const headers = findings.map((entry) => renderDoctorFinding(entry).split('\n')[0]);

    // Then, the subject is present and none of it is the literal the rule used to fall through to.
    expect(findings.length).toBe(4);
    expect(headers).toContain('DRIFT  DX050  webhook "onOrder"');
    expect(headers).toContain('DRIFT  DX050  "/a".additionalOperations');
    expect(headers).toContain(
      'DRIFT  DX050  "{$request.body#/url}" of callback "onEvent" on operation "get-a"',
    );
    expect(headers).toContain('DRIFT  DX050  "/a"');
    expect(headers.some((header) => (header ?? '').includes('(document)'))).toBe(false);
  });

  it('should still name the key to rename, so the header is an address and not the whole answer', () => {
    // Given
    const findings = buildDoctorReport(unreadKeyDocument()).findings.filter(
      (entry) => entry.code === 'DX050' && entry.subject === 'webhook "onOrder"',
    );

    // When
    const block = renderDoctorFinding(findings[0]!);

    // Then
    expect(block).toContain('rename the key "POST" to "post"');
  });
});
