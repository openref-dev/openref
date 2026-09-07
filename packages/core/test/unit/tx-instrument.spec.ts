import { describe, expect, it } from 'vitest';
import {
  classifyDrift,
  collectDrift,
  isMechanicallyFixable,
  normalizeOpenApiDocument,
  observedFactCollectors,
  operationRuleOutcome,
  RUNTIME_FACT_COLLECTORS,
  RUNTIME_FACT_FIELDS,
  runtimeInstrument,
  type IRDocument,
  type IRDriftIssue,
  type IRGuard,
  type IRNode,
  type IRNodeRuntime,
  type IROperation,
  type IRRuntimeMeta,
} from '../../src/index';

/**
 * `TX-INSTRUMENT`: an absence says which absence it is.
 *
 * THE IR HAS ALWAYS KEPT THE TWO APART AND NOTHING READ THE DIFFERENCE. `IRErrorContracts` says a
 * present empty group is an examined route and a missing field is nobody asked;
 * `IRRuntimeMeta.collectors` says what was asked for and `skipped` says what did not happen. Every
 * consumer printed one phrase over both. These cases hold each of the four answers to its own
 * meaning, and hold the two that changed severity and shape to the reason they changed.
 */

/** One operation, with whatever the case puts on it. */
function operation(overrides: Partial<IROperation> = {}): IROperation {
  return {
    kind: 'operation',
    id: 'get-orders',
    method: 'get',
    path: '/orders',
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
    ...(runtime === undefined ? {} : { runtime }),
  };
}

/** The findings one rule produced about one document. */
function issuesFor(rule: string, document: IRDocument): readonly IRDriftIssue[] {
  return collectDrift(document, { handledNodeIds: new Set(['get-orders']) }).filter(
    (issue) => issue.rule === rule,
  );
}

/** The same, with the guard to scheme mapping a host configured, per SPEC 13.2. */
function issuesWithSchemes(
  rule: string,
  document: IRDocument,
  guardSchemes: Record<string, string>,
): readonly IRDriftIssue[] {
  return collectDrift(document, {
    handledNodeIds: new Set(['get-orders']),
    guardSchemes: new Map(Object.entries(guardSchemes)),
  }).filter((issue) => issue.rule === rule);
}

const PIPE_FACT: IRNodeRuntime = {
  pipes: [
    { name: 'ValidationPipe', scope: 'global', confidence: 'derived', collector: 'pipesCollector' },
  ],
};

describe('runtimeInstrument, why one fact is missing from one node', () => {
  it('should answer unmeasured when no runtime pass ran on the document at all', () => {
    // Given a document nothing measured, which is every document normalized from a file
    const meta = undefined;

    // When
    const instrument = runtimeInstrument(meta, 'pipes', new Map());

    // Then
    expect(instrument).toEqual({ kind: 'unmeasured' });
  });

  it('should answer ran when the fact exists somewhere in the document', () => {
    // Given a pass whose registry names nothing this distribution ships for pipes, and a node
    // that carries a pipe anyway, which is what a host's own collector looks like from here
    const meta: IRRuntimeMeta = { collectors: ['someoneElsesCollector'] };
    const document = documentOf([operation({ runtime: PIPE_FACT })], meta);

    // When
    const instrument = runtimeInstrument(meta, 'pipes', observedFactCollectors(document));

    // Then the observed fact outranks the name table, so no list can call a real instrument absent
    expect(instrument).toEqual({ kind: 'ran', collector: 'pipesCollector' });
  });

  it('should answer ran when a shipped collector is registered and reported nothing anywhere', () => {
    // Given, which is the case a scan of the document alone would call absent
    const meta: IRRuntimeMeta = { collectors: ['pipesCollector'] };

    // When
    const instrument = runtimeInstrument(meta, 'pipes', new Map());

    // Then
    expect(instrument).toEqual({ kind: 'ran', collector: 'pipesCollector' });
  });

  it('should answer skipped with the registry own reason when a collector declined', () => {
    // Given the shape `@openref/collector-throttler` registers when its package is absent
    const meta: IRRuntimeMeta = {
      collectors: ['throttlerCollector'],
      skipped: [{ collector: 'throttlerCollector', reason: '@nestjs/throttler is not installed' }],
    };

    // When
    const instrument = runtimeInstrument(meta, 'rateLimit', new Map());

    // Then
    expect(instrument).toEqual({
      kind: 'skipped',
      collector: 'throttlerCollector',
      reason: '@nestjs/throttler is not installed',
    });
  });

  it('should answer absent, naming what would report it, when nothing for it is registered', () => {
    // Given the measured case: a host whose limiter is not @nestjs/throttler, so the shipped
    // rate limit collector is not in the registry and no node carries the fact
    const meta: IRRuntimeMeta = { collectors: ['guardsCollector', 'pipesCollector'] };

    // When
    const instrument = runtimeInstrument(meta, 'rateLimit', new Map());

    // Then, and both shipped names are offered rather than the first: a host whose limiter is
    // `@nestjs-redisx/rate-limit` must not read "add throttlerCollector" as the only answer
    expect(instrument).toEqual({
      kind: 'absent',
      shipped: ['throttlerCollector', 'redisxRateLimitCollector'],
    });
  });

  it('should offer all three policy collectors, since no one of them answers for the field', () => {
    // Given an application with no redisx module installed at all, so none of the three is
    // registered and no node carries a policy
    const meta: IRRuntimeMeta = { collectors: ['guardsCollector'] };

    // When
    const instrument = runtimeInstrument(meta, 'handlerPolicies', new Map());

    // Then all three are offered rather than the first, for the reason the rate limit row already
    // gives: a host who caches and does not lock must not be told to install the lock collector,
    // and the three read one library's three modules
    expect(instrument).toEqual({
      kind: 'absent',
      shipped: ['redisxCacheCollector', 'redisxLockCollector', 'redisxCircuitBreakerCollector'],
    });
  });

  it('should answer ran off a policy list, which carries its collector on its members', () => {
    // Given a node carrying one policy and a registry naming nobody this distribution ships
    const meta: IRRuntimeMeta = { collectors: ['someoneElsesCollector'] };
    const document = documentOf(
      [
        operation({
          runtime: {
            handlerPolicies: [
              {
                kind: 'lock',
                key: 'order:{0}',
                settings: [{ name: 'onFailure', value: 'throw' }],
                reach: 'handler',
                confidence: 'derived',
                collector: 'redisxLockCollector',
              },
            ],
          },
        }),
      ],
      meta,
    );

    // When
    const instrument = runtimeInstrument(meta, 'handlerPolicies', observedFactCollectors(document));

    // Then the list shape answers the way `guards` and `pipes` do, off its first member
    expect(instrument).toEqual({ kind: 'ran', collector: 'redisxLockCollector' });
  });

  it('should name a collector for every fact the IR can carry', () => {
    // Given, the subject is present: there are facts, and the record is total over them
    expect(RUNTIME_FACT_FIELDS.length).toBeGreaterThan(0);

    // When
    const empty = RUNTIME_FACT_FIELDS.filter(
      (field) => RUNTIME_FACT_COLLECTORS[field].length === 0,
    );

    // Then a fact with no instrument named for it is a cell that cannot explain itself
    expect(empty).toEqual([]);
  });
});

describe('observedFactCollectors', () => {
  it('should name the collector behind each fact the document carries', () => {
    // Given two nodes, one bare, one with facts of two different shapes
    const document = documentOf([
      operation({ id: 'get-a' }),
      operation({
        id: 'get-b',
        runtime: {
          ...PIPE_FACT,
          scopes: { value: ['orders:read'], confidence: 'declared', collector: 'scopesCollector' },
        },
      }),
    ]);

    // When
    const observed = observedFactCollectors(document);

    // Then
    expect(observed.get('pipes')).toBe('pipesCollector');
    expect(observed.get('scopes')).toBe('scopesCollector');
    expect(observed.has('guards')).toBe(false);
  });

  it('should record a present errors record whose groups are all empty as observed', () => {
    // Given, per SPEC 6.4 the field being present means the route was examined
    const document = documentOf([
      operation({ runtime: { errors: { declared: [], runtimeDerived: [], global: [] } } }),
    ]);

    // When
    const observed = observedFactCollectors(document);

    // Then it is observed, and it carries no name to be observed by, which is the empty string
    expect(observed.has('errors')).toBe(true);
    expect(observed.get('errors')).toBe('');
  });
});

describe('security-drift, a global guard is a weaker observation than a route guard', () => {
  const globalGuard: IRNodeRuntime = {
    guards: [
      {
        name: 'JwtAuthGuard',
        scope: 'global',
        confidence: 'derived',
        collector: 'guardsCollector',
      },
    ],
  };
  const routeGuard: IRNodeRuntime = {
    guards: [
      { name: 'JwtAuthGuard', scope: 'route', confidence: 'derived', collector: 'guardsCollector' },
    ],
  };

  it('should report a route guard against a silent specification as an error a fix may write', () => {
    // Given @UseGuards on the handler, which is somebody's decision about this route
    const document = documentOf([operation({ runtime: routeGuard })]);

    // When
    const issue = issuesFor('security-drift', document)[0];

    // Then nothing about the loud case moves
    expect(issue?.severity).toBe('error');
    expect(issue?.edit).toBe('new-assertion');
    expect(issue?.classification).toEqual({ bucket: 'silence' });
    expect(issue?.message).toBe(
      'A guard stands on this operation and the specification asserts no security.',
    );
  });

  it('should report a global guard as a warning that says the route may escape it unseen', () => {
    // Given one APP_GUARD provider and a route the host marked @Public(), which is metadata that
    // guard reads inside its own logic and nothing here can, per SPEC 6.1
    const document = documentOf([operation({ runtime: globalGuard })]);

    // When
    const issue = issuesFor('security-drift', document)[0];

    // Then it is reported, and it is reported as the weaker observation it is
    expect(issue?.severity).toBe('warning');
    expect(issue?.message).toContain('in front of the whole application');
    expect(issue?.message).toContain('not readable');
    expect(issue?.suggestion).toContain(
      'if a route level escape exempts it, nothing here is wrong',
    );
  });

  it('should never let a fix mode write a security requirement onto a globally guarded route', () => {
    // Given the same route, which before this change was a `silence` a fix mode could apply
    const document = documentOf([operation({ runtime: globalGuard })]);

    // When
    const issue = issuesFor('security-drift', document)[0];

    // Then, and this is the point of the new edit shape rather than of the severity
    expect(issue?.edit).toBe('unscoped-assertion');
    expect(issue?.classification).toEqual({ bucket: 'manual', reason: 'structural-ambiguity' });
    expect(issue !== undefined && isMechanicallyFixable(issue.classification, issue.basis)).toBe(
      false,
    );
  });

  it('should keep the error where a route guard stands beside an application wide one', () => {
    // Given both, because the route's own decision is the stronger of the two and it is present
    const document = documentOf([
      operation({
        runtime: { guards: [...(routeGuard.guards ?? []), ...(globalGuard.guards ?? [])] },
      }),
    ]);

    // When
    const issue = issuesFor('security-drift', document)[0];

    // Then
    expect(issue?.severity).toBe('error');
    expect(issue?.edit).toBe('new-assertion');
  });

  it('should print the document silence in words rather than as a JavaScript literal', () => {
    // Given, this string is printed under `OpenAPI:` by doctor and inside the drift card
    const document = documentOf([operation({ runtime: routeGuard })]);

    // When
    const issue = issuesFor('security-drift', document)[0];

    // Then
    expect(issue?.specValue).toBe('no security requirement');
    expect(issue?.specValue).not.toContain('undefined');
  });
});

describe('security-drift, a rate limiter is not an authorisation guard', () => {
  /** The guard `@RateLimit` installs, as the collector that read the decorator reports it. */
  const limiter: IRGuard = {
    name: 'RateLimitGuard',
    scope: 'route',
    purpose: 'rate-limit',
    confidence: 'derived',
    collector: 'redisxRateLimitCollector',
  };

  /** The application wide authentication guard the same application registers. */
  const globalAuth: IRGuard = {
    name: 'JwtAuthGuard',
    scope: 'global',
    confidence: 'derived',
    collector: 'guardsCollector',
  };

  it('should assert this fires on a route guard of unknown purpose, before anything is proved absent', () => {
    // Given the same route with the limiter's purpose unread, which is every guard
    // `guardsCollector` reports on its own
    const { purpose: _unread, ...unpurposed } = limiter;
    const document = documentOf([operation({ runtime: { guards: [unpurposed] } })]);

    // When
    const issues = issuesFor('security-drift', document);

    // Then the subject exists, so the absence below is an absence and not an empty fixture
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('error');
  });

  it('should stay out of scope where every guard on the route is a rate limiter', () => {
    // Given `POST /api/v1/dev/login`, whose sole route guard is the one `@RateLimit` installs.
    // `@RateLimit` is applyDecorators(SetMetadata(...), UseGuards(RateLimitGuard)), so the guard is
    // there because a limit is, and the branch that read only its SCOPE advised a deliberately
    // public token endpoint to declare security: a specification claiming a token is needed to get
    // a token.
    const document = documentOf([operation({ runtime: { guards: [limiter] } })]);

    // When
    const issues = issuesFor('security-drift', document);

    // Then nothing observed says this route is protected, so nothing is claimed
    expect(issues).toEqual([]);
  });

  it('should soften to the application wide reading when the only route guard is a limiter', () => {
    // Given the limiter on the route and one APP_GUARD provider behind it, which is the shape of
    // the application this was measured on
    const document = documentOf([operation({ runtime: { guards: [limiter, globalAuth] } })]);

    // When
    const issue = issuesFor('security-drift', document)[0];

    // Then the firmness comes from the guard that could carry it, and the limiter is named nowhere
    expect(issue?.severity).toBe('warning');
    expect(issue?.edit).toBe('unscoped-assertion');
    expect(issue?.message).toContain('in front of the whole application');
    expect(issue?.runtimeValue).toBe('JwtAuthGuard (application wide)');
    expect(issue?.runtimeValue).not.toContain('RateLimitGuard');
  });

  it('should keep the error where an authorisation guard stands beside a limiter', () => {
    // Given a route that is both limited and guarded, so the route's own authorisation decision is
    // present and the finding must not be softened by the limiter beside it
    const admin: IRGuard = {
      name: 'AdminGuard',
      scope: 'route',
      confidence: 'derived',
      collector: 'guardsCollector',
    };
    const document = documentOf([operation({ runtime: { guards: [limiter, admin] } })]);

    // When
    const issue = issuesFor('security-drift', document)[0];

    // Then
    expect(issue?.severity).toBe('error');
    expect(issue?.edit).toBe('new-assertion');
    expect(issue?.runtimeValue).toBe('AdminGuard');
  });
});

describe('security-drift, the scheme is named by the guard the firmness came from', () => {
  /** The route's own authorisation guard, which the host mapped to no scheme. */
  const routeAdmin: IRGuard = {
    name: 'AdminGuard',
    scope: 'route',
    confidence: 'derived',
    collector: 'guardsCollector',
  };

  /** The application wide guard, which the host did map. */
  const globalJwt: IRGuard = {
    name: 'JwtAuthGuard',
    scope: 'global',
    confidence: 'derived',
    collector: 'guardsCollector',
  };

  it('should assert the mapped scheme does reach the advice when it is the route guard own', () => {
    // Given the route guard itself mapped, which is the case the advice was written for
    const document = documentOf([operation({ runtime: { guards: [routeAdmin, globalJwt] } })]);

    // When
    const issue = issuesWithSchemes('security-drift', document, { AdminGuard: 'adminKey' })[0];

    // Then the subject exists: a mapped route guard names its own scheme
    expect(issue?.suggestion).toContain('"adminKey"');
    expect(issue?.assertion).toEqual({ kind: 'security-scheme', scheme: 'adminKey' });
  });

  it('should not name a scheme belonging to a guard the firmness did not come from', () => {
    // Given the firmness coming from `AdminGuard`, which maps to nothing, while the application
    // wide `JwtAuthGuard` beside it maps to `bearer`. `mapped` was assembled across every guard, so
    // the firm advice named a scheme read off a different guard entirely.
    const document = documentOf([operation({ runtime: { guards: [routeAdmin, globalJwt] } })]);

    // When
    const issue = issuesWithSchemes('security-drift', document, { JwtAuthGuard: 'bearer' })[0];

    // Then the finding stands, the firmness stands, and the borrowed name is gone
    expect(issue?.severity).toBe('error');
    expect(issue?.edit).toBe('new-assertion');
    expect(issue?.suggestion).not.toContain('bearer');
    expect(issue?.suggestion).toBe('add @ApiBearerAuth() or declare security in DocumentBuilder');
    expect(issue?.assertion).toEqual({ kind: 'unnameable', reason: 'unconfigured-mapping' });
  });

  it('should still name the application wide guard scheme in the softened branch', () => {
    // Given only the global guard, where the finding IS about that guard, so its scheme is the one
    // the advice is entitled to name
    const document = documentOf([operation({ runtime: { guards: [globalJwt] } })]);

    // When
    const issue = issuesWithSchemes('security-drift', document, { JwtAuthGuard: 'bearer' })[0];

    // Then
    expect(issue?.severity).toBe('warning');
    expect(issue?.assertion).toEqual({ kind: 'security-scheme', scheme: 'bearer' });
  });

  it('should keep comparing a declared requirement against every guard mapped on the route', () => {
    // Given a route that DOES assert security, where the comparison half of the rule asks whether
    // any observed guard maps to any required scheme. That half is right to read every guard: a
    // route requiring what its application wide guard enforces is not in disagreement with itself,
    // and narrowing it to the route's own guards would have reported one.
    const document = documentOf([
      operation({
        security: [{ schemeId: 'bearer', scopes: [] }],
        runtime: { guards: [routeAdmin, globalJwt] },
      }),
    ]);

    // When
    const issues = issuesWithSchemes('security-drift', document, { JwtAuthGuard: 'bearer' });

    // Then
    expect(issues).toEqual([]);
  });
});

describe('classifyDrift, the third state between having a fact and having none', () => {
  it('should file an unscoped assertion as a person decision and never as a silence', () => {
    // Given a real fact whose reach is not observable
    const basis = { kind: 'collected', confidence: 'declared' } as const;

    // When
    const classification = classifyDrift('unscoped-assertion', basis);

    // Then, and `declared` is the strongest confidence there is, so this cannot be reached by a
    // better collector, which is what filing it as confidence starvation would have promised
    expect(classification).toEqual({ bucket: 'manual', reason: 'structural-ambiguity' });
    expect(isMechanicallyFixable(classification, basis)).toBe(false);
  });
});

describe('orphan-operation, asked by a caller that holds only the document', () => {
  it('should answer out of scope when the observation records no pairing', () => {
    // Given the shape a renderer re-asking a rule from a served document can build: the guard
    // mapping the document carries, and no record of which operations had a handler
    const subject = operation();

    // When
    const outcome = operationRuleOutcome(subject, 'orphan-operation', {
      guardSchemes: new Map([['JwtAuthGuard', 'bearer']]),
    });

    // Then, an empty set here would have called every operation of the document an orphan
    expect(outcome).toBe('out-of-scope');
  });
});

describe('the health report labels name what they counted', () => {
  it('should count operations with a summary or a description under that name', () => {
    // Given the measured shape: every operation carries a summary and most carry no description,
    // which is what @nestjs/swagger produces from @ApiOperation({ summary })
    const document = documentOf([
      operation({ id: 'get-a', summary: 'List orders' }),
      operation({ id: 'get-b', summary: 'One order', description: 'Reads one order.' }),
    ]);

    // When
    const check = collectDrift(document);
    const report = issuesFor('missing-description', document);

    // Then the count is two of two and the label says so, where it used to say `description`
    expect(report).toEqual([]);
    expect(check.every((issue) => issue.rule !== 'missing-description')).toBe(true);
  });
});

describe('the normalizer keeps an operationId a document wrote outside paths', () => {
  it('should keep the id of a webhook operation', () => {
    // Given a 3.1 document whose webhook names itself
    const source = {
      openapi: '3.1.0',
      info: { title: 'Doc', version: '1' },
      paths: {},
      webhooks: {
        orderShipped: {
          post: { operationId: 'orderShipped', responses: { '200': { description: 'ok' } } },
        },
      },
    };

    // When
    const document = normalizeOpenApiDocument(source);
    const node = [...document.webhooks.values()][0];

    // Then, and until `TX-INSTRUMENT` both fields were absent whatever the document wrote
    expect(node?.kind === 'operation' && node.rawOperationId).toBe('orderShipped');
    expect(node?.kind === 'operation' && node.operationId).toBe('orderShipped');
  });

  it('should keep the id of a callback operation', () => {
    // Given a callback that names itself, which the OpenAPI tic-tac-toe example does
    const source = {
      openapi: '3.1.0',
      info: { title: 'Doc', version: '1' },
      paths: {
        '/orders': {
          post: {
            responses: { '200': { description: 'ok' } },
            callbacks: {
              onProgress: {
                '{$request.header.url}': {
                  post: {
                    operationId: 'markOperationCallback',
                    responses: { '200': { description: 'ok' } },
                  },
                },
              },
            },
          },
        },
      },
    };

    // When
    const document = normalizeOpenApiDocument(source);
    const node = [...document.nodes.values()].find((candidate) =>
      candidate.id.startsWith('callback-'),
    );

    // Then
    expect(node?.kind === 'operation' && node.rawOperationId).toBe('markOperationCallback');
  });

  it('should not promote a generated id to the public one, per SPEC 5.4', () => {
    // Given a webhook named the way @nestjs/swagger names things
    const source = {
      openapi: '3.1.0',
      info: { title: 'Doc', version: '1' },
      paths: {},
      webhooks: {
        shipped: {
          post: {
            operationId: 'OrdersController_shipped',
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    };

    // When
    const document = normalizeOpenApiDocument(source);
    const node = [...document.webhooks.values()][0];

    // Then the document's own value is kept where the rule and the header read it, and it does
    // not become the public id, which is the rewrite SPEC 5.4 asks for
    expect(node?.kind === 'operation' && node.rawOperationId).toBe('OrdersController_shipped');
    expect(node?.kind === 'operation' && node.operationId).toBeUndefined();
  });
});
