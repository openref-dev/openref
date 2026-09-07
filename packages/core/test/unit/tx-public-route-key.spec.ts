import { describe, expect, it } from 'vitest';
import {
  collectDrift,
  isMechanicallyFixable,
  type DriftObservation,
  type IRDocument,
  type IRDriftIssue,
  type IRGuard,
  type IRNode,
  type IRNodeRuntime,
  type IROperation,
  type IRRuntimeMeta,
} from '../../src/index';

/**
 * `TX-PUBLIC-ROUTE-KEY`: RT010 learns to read the mark, and says so differently when it cannot.
 *
 * WHAT WAS WRONG, AND IT WAS TWO THINGS RATHER THAN ONE. The state was unresolvable: for any
 * application with a guard under `APP_GUARD` and routes that are deliberately public, the softened
 * branch fired, told the reader that a route level escape might already exempt the route, and could
 * not be cleared by any edit, because `unscoped-assertion` classifies to `manual` and the only edit
 * that removed the row was a security requirement the specification would then be lying about. And
 * the branch's own reason was inaccurate: it said the decision is inside the guard, while the
 * ordinary guard reads `getAllAndOverride(IS_PUBLIC_KEY, [handler, class])`, which is metadata.
 *
 * WHY THE NEGATIVE CASE IS HERE AND NOT OPTIONAL. A suite holding only "a marked route is clean"
 * passes just as well over a rule that went silent on every route. The unmarked route on the same
 * document is what separates a rule that learned to read from a rule that stopped speaking.
 */

/** One operation, with whatever the case puts on it. */
function operation(overrides: Partial<IROperation> = {}): IROperation {
  return {
    kind: 'operation',
    id: 'get-health',
    method: 'get',
    path: '/health',
    deprecated: false,
    tags: [],
    parameters: [],
    responses: [],
    security: [],
    servers: [],
    ...overrides,
  };
}

/** A document holding those nodes, with the runtime meta the case is about. */
function documentOf(nodes: readonly IRNode[], runtime?: IRRuntimeMeta): IRDocument {
  return {
    id: 'analytics',
    kind: 'http',
    hash: '',
    info: { title: 'Analytics', version: '1.0.0' },
    servers: [],
    navigation: [],
    nodes: new Map(nodes.map((node) => [node.id, node])),
    schemas: new Map(),
    security: [],
    relationships: [],
    webhooks: new Map(),
    ...(runtime === undefined ? {} : { runtime }),
  };
}

/** The findings `security-drift` produced about one document. */
function findings(document: IRDocument, observation?: DriftObservation): readonly IRDriftIssue[] {
  return collectDrift(document, {
    handledNodeIds: new Set(document.nodes.keys()),
    ...observation,
  }).filter((issue) => issue.rule === 'security-drift');
}

/** The application wide authentication guard, as `guardsCollector` reports it. */
const GLOBAL_GUARD: IRGuard = {
  name: 'JwtAuthGuard',
  scope: 'global',
  confidence: 'derived',
  collector: 'guardsCollector',
};

/** A guard somebody wrote on the route itself, which is a decision about that route. */
const ROUTE_GUARD: IRGuard = {
  name: 'AdminGuard',
  scope: 'route',
  confidence: 'derived',
  collector: 'guardsCollector',
};

/** What `publicRouteCollector` attaches to a route the host marked. */
const MARKED: IRNodeRuntime = {
  guards: [GLOBAL_GUARD],
  guardExemption: {
    value: { declaredOn: 'handler' },
    confidence: 'derived',
    collector: 'publicRouteCollector',
  },
};

/** The same application's ordinary route: the guard stands there and no mark does. */
const UNMARKED: IRNodeRuntime = { guards: [GLOBAL_GUARD] };

/** The meta a pass writes once the host has named their key, per SPEC 6.3. */
const KEY_NAMED: IRRuntimeMeta = { collectors: ['guardsCollector'], publicRouteKey: 'isPublic' };

describe('security-drift, a route the host marked and one it did not, on one document', () => {
  it('should assert both routes are findings before the key is named, so the change is measurable', () => {
    // Given the state before this slice: one `APP_GUARD`, two routes, one of them deliberately
    // public, and no way for the host to say which, so the instrument cannot tell them apart
    const document = documentOf([
      operation({ id: 'get-health', runtime: UNMARKED }),
      operation({ id: 'get-orders', path: '/orders', runtime: UNMARKED }),
    ]);

    // When nothing names the key
    const issues = findings(document);

    // Then both rows stand, which is the state the entry called unresolvable
    expect(issues.map((issue) => issue.nodeId)).toEqual(['get-health', 'get-orders']);
  });

  it('should clear the marked route once the host names the key', () => {
    // Given the same document, and a host who has named the key their own guard reads
    const document = documentOf(
      [
        operation({ id: 'get-health', runtime: MARKED }),
        operation({ id: 'get-orders', path: '/orders', runtime: UNMARKED }),
      ],
      KEY_NAMED,
    );

    // When
    const issues = findings(document);

    // Then the marked route is gone
    expect(issues.map((issue) => issue.nodeId)).not.toContain('get-health');
  });

  it('should keep the unmarked route a finding on that same document', () => {
    // Given exactly the document above. THIS IS THE HALF THAT SEPARATES A RULE THAT LEARNED TO
    // READ FROM ONE THAT WENT SILENT, and without it the case above passes over both.
    const document = documentOf(
      [
        operation({ id: 'get-health', runtime: MARKED }),
        operation({ id: 'get-orders', path: '/orders', runtime: UNMARKED }),
      ],
      KEY_NAMED,
    );

    // When
    const issues = findings(document);

    // Then
    expect(issues.map((issue) => issue.nodeId)).toEqual(['get-orders']);
  });

  it('should count the cleared route as examined rather than dropping it out of scope', () => {
    // Given a document of one marked route. `clean` and `out-of-scope` are not the same answer:
    // the rule looked at this operation and the two sides agree, so it belongs in the denominator
    // the health report divides by.
    const document = documentOf([operation({ runtime: MARKED })], KEY_NAMED);

    // When
    const health = collectDrift(document, { handledNodeIds: new Set(['get-health']) });

    // Then no finding, and the operation was still a subject
    expect(health.filter((issue) => issue.rule === 'security-drift')).toEqual([]);
  });
});

describe('security-drift, the two sentences and which one fires', () => {
  it('should say the decision is inside the guard where no key was named', () => {
    // Given a host who has configured nothing, for whom the old sentence is exactly true: a guard
    // that decides without metadata is unreadable, and that is the whole reason for the refusal
    const document = documentOf([operation({ runtime: UNMARKED })]);

    // When
    const issue = findings(document)[0];

    // Then not one word of it moves
    expect(issue?.message).toBe(
      'A guard stands in front of the whole application and the specification asserts no security ' +
        'here. Whether this route is exempt is decided inside that guard, which is not readable.',
    );
    expect(issue?.suggestion).toContain(
      'if a route level escape exempts it, nothing here is wrong',
    );
  });

  it('should say the route carries no mark where the key was named', () => {
    // Given the same route on an application that named its key. The first sentence is now FALSE
    // about this application: the decision is readable, and what was read is that there is no mark.
    const document = documentOf([operation({ runtime: UNMARKED })], KEY_NAMED);

    // When
    const issue = findings(document)[0];

    // Then the reader is told the true thing rather than the softer one
    expect(issue?.message).toBe(
      'A guard stands in front of the whole application and the specification asserts no security ' +
        'here. This route carries no exemption under "isPublic", which is the key this application ' +
        'names.',
    );
    expect(issue?.message).not.toContain('not readable');
  });

  it('should give an action instead of the second reading, where the key was named', () => {
    // Given the same route. "Nothing here is wrong" is no longer one of the two readings: either
    // the route is protected and undocumented, or it is public and unmarked, and both are edits.
    const document = documentOf([operation({ runtime: UNMARKED })], KEY_NAMED);

    // When
    const issue = findings(document)[0];

    // Then
    expect(issue?.suggestion).toBe(
      'declare security in DocumentBuilder if this route is protected, or mark it with the ' +
        'decorator that writes "isPublic" if it is public',
    );
    expect(issue?.suggestion).not.toContain('nothing here is wrong');
  });

  it('should print the same two sentences to a caller re-asking with only an observation', () => {
    // Given the parity gutter, which holds no document and is handed what the document carried
    const document = documentOf([operation({ runtime: UNMARKED })]);

    // When
    const issue = findings(document, { publicRouteKey: 'isPublic' })[0];

    // Then one input, one answer, wherever the question is asked from
    expect(issue?.message).toContain('carries no exemption under "isPublic"');
  });
});

describe('security-drift, what the mark is not allowed to silence', () => {
  it('should keep the error where a route scope authorisation guard stands on a marked route', () => {
    // Given `@Public()` and `@UseGuards(AdminGuard)` on one handler. The mark says the route
    // escapes the APPLICATION WIDE guard; the route guard is a second decision with a second
    // cause, and the document is silent about both.
    const document = documentOf(
      [
        operation({
          runtime: { ...MARKED, guards: [GLOBAL_GUARD, ROUTE_GUARD] },
        }),
      ],
      KEY_NAMED,
    );

    // When
    const issue = findings(document)[0];

    // Then nothing about the loud case moves
    expect(issue?.severity).toBe('error');
    expect(issue?.edit).toBe('new-assertion');
    expect(issue?.runtimeValue).toBe('JwtAuthGuard (application wide), AdminGuard');
    expect(issue?.message).toBe(
      'A guard stands on this operation and the specification asserts no security.',
    );
  });
});

describe('security-drift, the severity was re-asked and did not move', () => {
  it('should keep the unmarked route a warning no fix mode may write', () => {
    // Given a route with no mark on an application that named its key. The absence of a mark under
    // one key does not establish that the guard admits this route: it may exempt it on grounds it
    // computes itself, which SPEC 6.1 still forbids guessing at. What changed is the sentence and
    // the action, not what a fix mode may write.
    const document = documentOf([operation({ runtime: UNMARKED })], KEY_NAMED);

    // When
    const issue = findings(document)[0];

    // Then
    expect(issue?.severity).toBe('warning');
    expect(issue?.edit).toBe('unscoped-assertion');
    expect(issue?.classification).toEqual({ bucket: 'manual', reason: 'structural-ambiguity' });
    expect(issue !== undefined && isMechanicallyFixable(issue.classification, issue.basis)).toBe(
      false,
    );
  });
});
