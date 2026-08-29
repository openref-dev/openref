import { describe, expect, it } from 'vitest';
import {
  buildDoctorReport,
  buildHealthReport,
  DRIFT_RULE_CODES,
  normalizeOpenApiDocument,
  type IRDiscoveryProblem,
  type IRDocument,
} from '../../src/index';

/**
 * The rule that prints what the discovery of a running application could not state, per SPEC 7.1.
 *
 * WHAT IT REPLACES IS SILENCE, AND THE SILENCE WAS TWO LISTS DEEP. SPEC 8.3 called six cases of the
 * event surface «находка `doctor`» from `T051` and `doctor` printed none of them; the HTTP side has
 * had the same shape and the same missing reader since `T019`. `T054` gave both one carrier,
 * `IRRuntimeMeta.problems`, and one rule over it, and these cases are what say the finding travels
 * from the carrier to the printed report rather than into another list nobody reads.
 */

const PROBLEMS: readonly IRDiscoveryProblem[] = [
  {
    subject: 'OrdersGateway',
    reason:
      'it is a WebSocket gateway with no @SubscribeMessage handler, so it declares no event ' +
      'and no channel was produced for it',
  },
  {
    subject: 'OrdersController.get',
    reason: '1 of its patterns is neither a string, a number nor an object',
  },
  {
    subject: 'the amqp broker',
    reason: 'the application serves channels over amqp and no host was configured for it',
  },
];

function documentWith(problems: readonly IRDiscoveryProblem[]): IRDocument {
  const base = normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Orders', version: '1' },
    paths: {
      '/orders': {
        get: {
          operationId: 'listOrders',
          summary: 'List orders',
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  });

  return {
    ...base,
    runtime: { collectors: ['guardsCollector'], ...(problems.length === 0 ? {} : { problems }) },
  };
}

describe('discovery-incomplete', () => {
  it('should print one finding per problem, naming the subject the discovery named', () => {
    // Given a document whose runtime meta carries three problems of three different producers
    const document = documentWith(PROBLEMS);

    // When
    const report = buildDoctorReport(document);
    const found = report.findings.filter((finding) => finding.rule === 'discovery-incomplete');

    // Then each one is printed, under the display code SPEC 7.1 gives the rule, naming its own
    // subject rather than `(document)`, with the reason as the action a reader takes. WHAT USED TO
    // HAPPEN: the problems reached `MountedReference.eventProblems` or
    // `RuntimePassResult.discoveryProblems`, no reader outside a test ever opened either, and
    // `doctor` printed nothing at all.
    expect(found).toHaveLength(3);
    expect(found.map((finding) => finding.subject)).toEqual([
      'OrdersGateway',
      'OrdersController.get',
      'the amqp broker',
    ]);
    expect(new Set(found.map((finding) => finding.code))).toEqual(
      new Set([DRIFT_RULE_CODES['discovery-incomplete']]),
    );
    expect(found[0]?.suggestion).toBe(PROBLEMS[0]?.reason);
    expect(found[0]?.severity).toBe('warning');
  });

  it('should carry the subject and the reason in the message as one sentence', () => {
    // Given the same document. The message is what `--json` carries and what the render side
    // groups by, and it has to stand on its own without the subject beside it.
    const finding = buildDoctorReport(documentWith(PROBLEMS)).findings.find(
      (candidate) => candidate.rule === 'discovery-incomplete',
    );

    // When, Then
    const first = PROBLEMS[0];
    expect(first).toBeDefined();
    expect(finding?.message).toBe(`${String(first?.subject)}: ${String(first?.reason)}`);
  });

  it('should move no existing score when the discovery stated everything it found', () => {
    // Given the same document with no problems at all, and the same one with three. The scope of
    // the rule is the problems themselves, per SPEC 7.1, so a clean application must not be given
    // a row it always fails.
    const clean = buildHealthReport(documentWith([]));
    const dirty = buildHealthReport(documentWith(PROBLEMS));

    const check = (report: typeof clean): { passed: number; total: number } | undefined => {
      const found = report.checks.find((entry) => entry.id === 'discovery-incomplete');
      return found === undefined ? undefined : { passed: found.passed, total: found.total };
    };

    // When, Then the check exists in both, counts nothing in the first and is therefore dropped by
    // `healthScore`, and the two scores differ, which is what says the second is really counted.
    expect(check(clean)).toEqual({ passed: 0, total: 0 });
    expect(check(dirty)).toEqual({ passed: 0, total: 3 });
    expect(clean.score).toBe(100);
    expect(dirty.score).toBeLessThan(clean.score);
  });

  it('should give a document with no runtime meta at all no row and no finding', () => {
    // Given a plain specification, which is what `lint` reads: there is no discovery behind it, so
    // there is no subject, which is not the same as a discovery that found nothing
    const bare = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Bare', version: '1' },
      paths: {},
    });

    // When
    const report = buildDoctorReport(bare);

    // Then
    expect(bare.runtime).toBeUndefined();
    expect(report.findings.filter((finding) => finding.rule === 'discovery-incomplete')).toEqual(
      [],
    );
    expect(report.checks.find((check) => check.id === 'discovery-incomplete')?.total).toBe(0);
  });

  it('should leave every other rule naming its node or its schema exactly as before', () => {
    // Given a document that carries problems and also an operation nothing describes, so the
    // report holds findings of both kinds. The subject member added for this rule is optional and
    // no other rule sets it, so a node finding must still be named by its method and path; without
    // this case the change could have silently renamed every finding in the report.
    const undescribed = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Orders', version: '1' },
      paths: {
        '/orders': {
          get: { operationId: 'listOrders', responses: { '200': { description: 'ok' } } },
        },
      },
    });
    const report = buildDoctorReport({
      ...undescribed,
      runtime: { collectors: ['guardsCollector'], problems: PROBLEMS },
    });
    const others = report.findings.filter((finding) => finding.rule !== 'discovery-incomplete');

    // When, Then. The subject is asserted present first: there really are other findings here.
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((finding) => finding.subject === 'GET /orders')).toBe(true);
  });
});
