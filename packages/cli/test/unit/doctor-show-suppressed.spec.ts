import {
  buildDoctorReport,
  buildHealthReport,
  type IRDocument,
  type IRNode,
  type IROperation,
} from '@openref/core';
import { describe, expect, it } from 'vitest';
import {
  renderDoctorSummary,
  renderSuppressedFindings,
} from '../../src/cli/api/commands/doctor-report-text';
import { DOCTOR_USAGE } from '../../src/cli/api/help';

/**
 * What `doctor` prints about a class the host decided not to fix, per SPEC 7.2.
 *
 * THIS IS THE ONE SURFACE WHERE A REAL FLAG FITS. The page holds the suppressed half in a closed
 * disclosure, because a page is read by a person who can open it; a command writes to a pipe, so
 * the two states have to be two runs. `--show-suppressed` is the second run.
 *
 * THE SUMMARY SAYS SO WITHOUT THE FLAG, which is the half that matters more. A reader who never
 * types the flag still learns that 111 findings and two classes are missing from the list they are
 * looking at, and which reasons took them out, because a report that hides its own filtering is
 * the report this option was built to stop the maintainer from having.
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

/** A 200 response carrying a body and no written example. */
function ok(): IROperation['responses'][number] {
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

/** A document with two classes suppressed and one class that matched nothing. */
function suppressed(): IRDocument {
  const nodes = [
    operation({ id: 'a', path: '/a', summary: 'A', responses: [ok()] }),
    operation({ id: 'b', path: '/b', summary: 'B', responses: [ok()] }),
  ];
  const document = documentOf(nodes);

  return {
    ...document,
    health: buildHealthReport(document, {
      suppress: [
        { rule: 'missing-example', reason: 'examples live in the client SDK repository' },
        { rule: 'stream-unspecified', reason: 'streams are documented in the wiki' },
      ],
    }),
  };
}

describe('doctor with suppression', () => {
  it('should print the marked score rather than the bare number', () => {
    // Given
    const report = buildDoctorReport(suppressed());

    // When
    const summary = renderDoctorSummary(report, 'Orders 1.0.0');

    // Then the same string the page prints, so a reader comparing a build log against the
    // reference is comparing one sentence with itself. THIS FIXTURE INVERTS, because one of its
    // two suppressed classes is `stream-unspecified` at severity `error`, so the line leads with
    // the unsuppressed figure and names the suppressed one second.
    expect(summary).toContain(`Documentation health: ${report.scoreText}`);
    expect(summary).toMatch(/Documentation health: \d+% \(\d+% suppressed\)/);
    expect(summary).toContain('the health percentage above is the UNSUPPRESSED one');
  });

  it('should name every suppressed class, its reason and how many it took, without any flag', () => {
    // Given
    const report = buildDoctorReport(suppressed());

    // When
    const summary = renderDoctorSummary(report, 'Orders 1.0.0');

    // Then
    expect(summary).toContain('Suppressed by this application:');
    expect(summary).toContain(
      'DX020  missing-example  2  examples live in the client SDK repository',
    );
  });

  it('should report a suppression that matched nothing with its zero', () => {
    // Given a class this deployment has no subject for at all
    const report = buildDoctorReport(suppressed());

    // When
    const summary = renderDoctorSummary(report, 'Orders 1.0.0');

    // Then it did not refuse boot, so this line is the whole of the warning, and it is here rather
    // than behind a flag because the day the class comes back it starts suppressing in silence.
    expect(summary).toContain(
      'RT040  stream-unspecified  0  streams are documented in the wiki  (matched nothing)',
    );
  });

  it('should print nothing about suppression on a document with none', () => {
    // Given
    const bare = documentOf([operation({ id: 'a', path: '/a', summary: 'A', responses: [ok()] })]);
    const report = buildDoctorReport({ ...bare, health: buildHealthReport(bare) });

    // When
    const summary = renderDoctorSummary(report, 'Orders 1.0.0');

    // Then the output of every host that has not configured the option does not move
    expect(summary).not.toContain('Suppressed');
    expect(summary).toMatch(/Documentation health: \d+%\n/);
  });

  it('should render the suppressed findings as ordinary blocks for --show-suppressed', () => {
    // Given
    const report = buildDoctorReport(suppressed());

    // When
    const block = renderSuppressedFindings(report.suppressedFindings ?? []);

    // Then, the same anatomy as a drawn finding, because they are the same findings and a second
    // reduced shape for one of the two halves would be a second report
    expect(report.suppressedFindings).toHaveLength(2);
    expect(block).toContain('DRIFT  DX020  GET /a');
    expect(block).toContain('DRIFT  DX020  GET /b');
  });

  it('should print nothing for a run with no suppressed finding to show', () => {
    // Given, `--show-suppressed` on a document with none is not an error and prints no heading
    // over an empty list
    expect(renderSuppressedFindings([])).toBe('');
  });

  it('should name the flag in the usage text, since an undeclared flag is a usage error', () => {
    // Given, `parseArgs` refuses anything the command did not declare, so a flag missing from the
    // help is a flag a reader cannot discover and a flag present in the help but not in the
    // parser is a documented usage error
    expect(DOCTOR_USAGE).toContain('--show-suppressed');
  });
});
