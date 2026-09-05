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

  it('should say the reason once, with the subject beside it rather than inside it', () => {
    // Given the same document. WHAT USED TO HAPPEN, and what this case exists to keep from coming
    // back: `message` was built as `${subject}: ${reason}` and `suggestion` was set to the same
    // `reason`, on the reading that `openref doctor` prints the subject and the suggestion and
    // never the message. It does; every browser theme prints the message and the suggestion one
    // under the other, so a reader of the health page was shown one sentence twice in every
    // finding, once with the subject glued to the front of it. Measured on the maintainer's
    // application: 68 findings carrying 136 copies of five sentences.
    const finding = buildDoctorReport(documentWith(PROBLEMS)).findings.find(
      (candidate) => candidate.rule === 'discovery-incomplete',
    );

    // When, Then the subject is present and is the finding's own member, the message is the reason
    // and nothing else, and neither string contains the other.
    const first = PROBLEMS[0];
    expect(first).toBeDefined();
    expect(finding?.subject).toBe(first?.subject);
    expect(finding?.message).toBe(first?.reason);
    expect(finding?.message).not.toContain(String(first?.subject));
  });

  it('should print the action a producer wrote rather than repeating its reason', () => {
    // Given one problem written to SPEC 7.1's voice, with the three parts in three members, and
    // one written the way every producer wrote them before the split
    const split: IRDiscoveryProblem = {
      subject: 'OrdersController.list',
      reason: 'a custom parameter decorator reads the request itself, so what it reads is unknown',
      action: 'nothing to do here: no better instrument can see through the decorator',
      detail: 'The factory receives the whole execution context and may take anything out of it.',
    };
    const unsplit = PROBLEMS[1];
    expect(unsplit).toBeDefined();
    if (unsplit === undefined) return;

    // When
    const found = buildDoctorReport(documentWith([split, unsplit])).findings.filter(
      (finding) => finding.rule === 'discovery-incomplete',
    );

    // Then the split one carries three different strings, and the unsplit one is exactly where it
    // was: `renderDoctorFinding` prints the suggestion and never the message, so a fallback of
    // anything but the reason would have emptied `doctor` for every producer not yet moved.
    expect(found).toHaveLength(2);
    expect(found[0]?.message).toBe(split.reason);
    expect(found[0]?.suggestion).toBe(split.action);
    expect(found[0]?.message).not.toBe(found[0]?.suggestion);
    expect(found[1]?.message).toBe(unsplit.reason);
    expect(found[1]?.suggestion).toBe(unsplit.reason);
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
