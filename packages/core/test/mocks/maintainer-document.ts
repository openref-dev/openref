import type {
  DriftObservation,
  IRDiscoveryProblem,
  IRDocument,
  IRFact,
  IRGuard,
  IRHealthCheck,
  IRJsonSchema,
  IRMediaType,
  IRNode,
  IRNodeRuntime,
  IROperation,
  IRParameter,
  IRParameterRead,
  IRParameterReads,
  IRResponse,
  IRSchema,
  IRSecurityRequirement,
  IRSecurityScheme,
  IRSourceLocation,
  IRStreaming,
} from '../../src/index';

/**
 * The document behind the figures SPEC 7.2 and the drift rules quote, rebuilt so a test can hold it.
 *
 * EVERY NUMBER IN THIS FILE WAS MEASURED BEFORE IT WAS WRITTEN. `health.ts`, `drift-rules.ts` and
 * the remediation plan all reason from one application: 58 operations, 180 findings, 53 of them one
 * sentence repeated, 58 more naming a generated `Controller_method`, 466 DTO fields of which 34
 * carry no description. Those figures decided the severity weights, the root of the subject count
 * and the folding of findings by cause, and until this fixture existed nothing in the repository
 * could be asked whether they still hold. The application itself is not in this repository and
 * cannot be, so what is reconstructed is the shape that produces the same profile, per rule and per
 * count, and nothing else about it is claimed.
 *
 * IT IS ARRANGED BY INDEX RATHER THAN BY HAND, so each rule's denominator is one constant and a
 * reader can check a row by reading the constant above it. The operations are `op-00` to `op-57`,
 * built from the index alone, so the document is byte identical between two runs and carries no
 * clock, no counter and no random value.
 */

/** How many operations the measured application documents. */
const OPERATIONS = 58;

/** Named schemas, sized below so their fields total 466. */
const SCHEMAS = 34;

/** The first schemas carry one field more, which is what puts the field count on 466. */
const WIDE_SCHEMAS = 24;

/** Fields on one of the wider schemas. */
const WIDE_FIELDS = 14;

/** Fields on one of the narrower schemas, so 24 x 14 plus 10 x 13 is 466. */
const NARROW_FIELDS = 13;

/**
 * Operations whose route carries a guard that authorises rather than counts.
 *
 * This is `security-drift`'s denominator only once a mapping exists, per the rule: without one it
 * has nothing to compare and every operation that declares security falls out of scope again.
 */
const GUARDED = 26;

/** Of the guarded ones, those whose specification declares the scheme the guard maps to. */
const GUARD_DOCUMENTED = 22;

/** Unguarded operations that declare security anyway, so `scope-drift` reaches 29 subjects. */
const SECURED_ONLY_FROM = 26;

/** One past the last of them. */
const SECURED_ONLY_TO = 33;

/** The one operation whose declared scopes the security requirement does not list. */
const SCOPE_DRIFT_AT = 32;

/** Operations a collector reported as streaming. */
const STREAMING = 52;

/** The first streaming operation whose item type nothing states at all. */
const STREAM_ITEM_ABSENT_FROM = 45;

/** One past the last of those, after which the item type is known only at `inferred`. */
const STREAM_ITEM_ABSENT_TO = 50;

/** Operations whose handler the parameter scan accounted for. */
const PARAMETER_SCANNED = 57;

/** One past the last operation carrying a declared parameter the scan never saw read. */
const PARAMETER_UNREAD_TO = 12;

/** Operations a guard requires the tenant header on. */
const REQUIRED_HEADER = 24;

/** The one of those whose header parameter the specification marks optional. */
const HEADER_DRIFT_AT = 23;

/** Operations whose handler carries an explicit `@HttpCode`. */
const EXPLICIT_STATUS = 56;

/** The first of those answering a code no response documents. */
const STATUS_DRIFT_FROM = 53;

/** Operations carrying a written example on a body. */
const EXAMPLES = 5;

/** The guard class the whole application authorises with. */
const GUARD_CLASS = 'JwtAuthGuard';

/** The security scheme that guard maps to, as a host would configure the mapping. */
const SECURITY_SCHEME = 'bearer';

/** The header a guard refuses the request without. */
const TENANT_HEADER = 'X-Tenant-Id';

/**
 * Method names the controllers reuse, which is why the generated ids collide.
 *
 * `missing-operation-id` words its suggestion differently for a name several operations lay claim
 * to, and the measured application has six controllers reaching for `list`. The counts do not
 * depend on this; the sentences a reader is shown do.
 */
const HANDLERS = ['list', 'create', 'getOne', 'update', 'patch', 'remove'] as const;

/** The requirement the twenty nine secured operations declare. */
const SECURITY_REQUIREMENT: IRSecurityRequirement = {
  schemeId: SECURITY_SCHEME,
  scopes: ['orders:read'],
};

/** The scheme the requirement names, so the document is readable on its own terms. */
const SECURITY_SCHEMES: readonly IRSecurityScheme[] = [
  { id: SECURITY_SCHEME, type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
];

/**
 * What the discovery of the running application found and could not state, per SPEC 8.3.
 *
 * SEVEN, WHICH IS `discovery-incomplete`'s WHOLE DENOMINATOR: the rule's subjects are the problems
 * themselves, so it is 0 of 7 and never anything else.
 */
const DISCOVERY_PROBLEMS: readonly IRDiscoveryProblem[] = [
  {
    subject: 'ReportsController.stream',
    reason:
      'The handler binds the whole request object, so no parameter access path was accounted for.',
    action: 'bind the values with @Query and @Param, or accept that this route reports no reads',
  },
  {
    subject: 'ReportsController.download',
    reason:
      'A custom parameter decorator stands where a binding would, and its source is not read.',
    action: 'nothing here; the scan refuses to guess past a decorator it did not write',
  },
  {
    subject: 'BillingGateway',
    reason: 'The gateway declares no event, so no channel could be named for it.',
    action: 'declare the events with @SubscribeMessage, or leave the gateway out of the reference',
  },
  {
    subject: 'orders.{tenant}.events',
    reason: 'The address is templated and nothing states what the variable takes.',
    action: 'declare the parameter so the address can be read',
  },
  {
    subject: 'kafka broker',
    reason: 'No host was configured, so the broker has a protocol and no address.',
    action: 'configure the broker host, or expect the page to draw the protocol alone',
  },
  {
    subject: 'AuditController.replay',
    reason: 'The item type of the stream is a type parameter, which does not survive compilation.',
    action: 'add @ApiStream({ itemType: YourDto }) to the handler',
  },
  {
    subject: 'NotificationsGateway.push',
    reason: 'The payload class is named and no supplied schema answers to that name.',
    action: 'register the schema, or name the payload with a class the document already holds',
  },
];

/**
 * Which of the reused method names an operation's handler carries.
 *
 * @param index - Position of the operation
 * @returns The method name
 */
function handlerName(index: number): string {
  return HANDLERS[index % HANDLERS.length] ?? 'list';
}

/**
 * The id of one named schema.
 *
 * @param index - Position of the schema
 * @returns Its id, stable across runs
 */
function schemaId(index: number): string {
  return `Dto${String(index).padStart(2, '0')}`;
}

/**
 * One named schema, whose first field carries no description and whose rest do.
 *
 * @param index - Position of the schema
 * @returns The schema, with every field flat so the walk counts exactly what is written here
 */
function schemaAt(index: number): IRSchema {
  const fields = index < WIDE_SCHEMAS ? WIDE_FIELDS : NARROW_FIELDS;
  const properties: Record<string, IRJsonSchema> = {};

  for (let field = 0; field < fields; field += 1) {
    const name = `field${String(field).padStart(2, '0')}`;
    properties[name] =
      field === 0 ? { type: 'string' } : { type: 'string', description: `What ${name} carries.` };
  }

  return {
    id: schemaId(index),
    name: schemaId(index),
    dialect: 'json-schema-2020-12',
    normalized: { type: 'object', properties },
  };
}

/**
 * What the specification declares about one operation's parameters.
 *
 * @param index - Position of the operation
 * @returns The declared parameters, in document order
 */
function parametersAt(index: number): readonly IRParameter[] {
  const parameters: IRParameter[] = [];

  if (index < REQUIRED_HEADER) {
    parameters.push({
      name: TENANT_HEADER,
      in: 'header',
      // THE ONE OPERATION THE RUNTIME AND THE DOCUMENT DISAGREE ABOUT, which is
      // `header-requiredness-drift`'s single finding: the guard refuses without the header and the
      // specification says it is optional.
      required: index !== HEADER_DRIFT_AT,
      style: 'simple',
      explode: false,
    });
  }

  parameters.push({ name: 'limit', in: 'query', required: false, style: 'form', explode: true });

  if (index < PARAMETER_UNREAD_TO) {
    parameters.push({ name: 'cursor', in: 'query', required: false, style: 'form', explode: true });
  }

  return parameters;
}

/**
 * What the handler scan concluded about those parameters.
 *
 * THE UNREAD ONE IS A QUERY PARAMETER DELIBERATELY. A header the `requiredHeaders` fact names counts
 * as read, per `parameter-unread`, so putting the unread declaration in a header would have made
 * this rule and `header-requiredness-drift` decide each other's counts.
 *
 * @param index - Position of the operation
 * @returns One verdict per declared parameter
 */
function parameterReadsAt(index: number): IRParameterReads {
  const parameters: IRParameterRead[] = [];

  if (index < REQUIRED_HEADER) {
    parameters.push({ in: 'header', name: TENANT_HEADER, verdict: 'read' });
  }

  parameters.push({ in: 'query', name: 'limit', verdict: 'read' });

  if (index < PARAMETER_UNREAD_TO) {
    parameters.push({ in: 'query', name: 'cursor', verdict: 'not-seen-read' });
  }

  return { parameters };
}

/**
 * The streaming fact, in the three states `stream-unspecified` tells apart.
 *
 * @param index - Position of the operation, which is below {@link STREAMING}
 * @returns The fact, with or without an item type and at the confidence it was read at
 */
function streamingAt(index: number): IRFact<IRStreaming> {
  const item: IRStreaming = {
    transport: 'sse',
    itemSchema: { kind: 'named', schemaId: schemaId(index % SCHEMAS) },
  };

  if (index < STREAM_ITEM_ABSENT_FROM) {
    return { value: item, confidence: 'declared', collector: 'streamingCollector' };
  }

  if (index < STREAM_ITEM_ABSENT_TO) {
    return {
      value: { transport: 'sse' },
      confidence: 'declared',
      collector: 'streamingCollector',
    };
  }

  return { value: item, confidence: 'inferred', collector: 'streamingCollector' };
}

/**
 * Everything the collectors attached to one operation.
 *
 * @param index - Position of the operation
 * @param controller - Class the handler lives on
 * @param handler - Method name, which is what `missing-operation-id` would propose
 * @returns The runtime facts, each carrying its confidence and its collector
 */
function runtimeAt(index: number, controller: string, handler: string): IRNodeRuntime {
  const source: IRSourceLocation = {
    controller,
    handler,
    file: `src/${controller}.ts`,
    line: 12 + index,
  };

  const guards: readonly IRGuard[] = [
    { name: GUARD_CLASS, scope: 'route', confidence: 'declared', collector: 'guardsCollector' },
  ];

  const scopes: IRFact<readonly string[]> = {
    // THE ONE OPERATION WHOSE REQUIREMENT LISTS FEWER SCOPES THAN THE CODE DECLARES, which is
    // `scope-drift`'s single finding.
    value: index === SCOPE_DRIFT_AT ? ['orders:read', 'orders:write'] : ['orders:read'],
    confidence: 'declared',
    collector: 'scopesCollector',
  };

  const requiredHeaders: IRFact<readonly string[]> = {
    value: [TENANT_HEADER],
    confidence: 'derived',
    collector: 'requiredHeadersCollector',
  };

  const parameterReads: IRFact<IRParameterReads> = {
    value: parameterReadsAt(index),
    confidence: 'derived',
    collector: 'parameterReadsCollector',
  };

  const statusCode: IRFact<number> = {
    // 204 ON THE LAST THREE, AGAINST A DOCUMENT THAT ONLY EVER WRITES 200, which is
    // `status-drift`'s three findings and the conflicting half of the rule.
    value: index < STATUS_DRIFT_FROM ? 200 : 204,
    confidence: 'declared',
    collector: 'statusCodeCollector',
  };

  return {
    source,
    ...(index < GUARDED ? { guards } : {}),
    ...(isSecured(index) ? { scopes } : {}),
    ...(index < REQUIRED_HEADER ? { requiredHeaders } : {}),
    ...(index < PARAMETER_SCANNED ? { parameterReads } : {}),
    ...(index < EXPLICIT_STATUS ? { statusCode } : {}),
    ...(index < STREAMING ? { streaming: streamingAt(index) } : {}),
  };
}

/**
 * Whether the specification declares a security requirement on this operation.
 *
 * @param index - Position of the operation
 * @returns True for the twenty two guarded ones that document it and the seven unguarded ones
 */
function isSecured(index: number): boolean {
  return index < GUARD_DOCUMENTED || (index >= SECURED_ONLY_FROM && index < SECURED_ONLY_TO);
}

/**
 * The responses of one operation, which is the one success every route of the application writes.
 *
 * @param index - Position of the operation
 * @returns One 200, whose media type carries an example on the first five operations
 */
function responsesAt(index: number): readonly IRResponse[] {
  const media: IRMediaType = {
    mediaType: 'application/json',
    schema: { kind: 'named', schemaId: schemaId(index % SCHEMAS) },
    ...(index < EXAMPLES ? { example: { id: `resource-${String(index)}` } } : {}),
  };

  return [{ statusCode: '200', description: 'ok', content: [media] }];
}

/**
 * One operation of the reconstruction.
 *
 * @param index - Position of the operation, 0 to 57
 * @returns The operation, with the facts its index says it carries
 */
function operationAt(index: number): IROperation {
  const suffix = String(index).padStart(2, '0');
  const controller = `Controller${String(Math.floor(index / HANDLERS.length))}`;
  const handler = handlerName(index);

  return {
    kind: 'operation',
    id: `op-${suffix}`,
    method: 'get',
    path: `/api/v1/resource-${suffix}`,
    operationId: `op-${suffix}`,
    // GENERATED ON ALL FIFTY EIGHT, which is what `missing-operation-id` reads: none of these was
    // written by a person, so the rule counts every operation and passes none of them.
    rawOperationId: `${controller}_${handler}`,
    // A SUMMARY AND NO DESCRIPTION, WHICH IS WHY THE ROW READS 58 OF 58. The rule passes on either
    // field, per its own predicate, and the label naming both is what stopped that count reading as
    // a claim that every operation carries prose. The measured application has seven that do.
    summary: `Operation ${suffix} of the measured application.`,
    tags: ['measured'],
    deprecated: false,
    parameters: parametersAt(index),
    responses: responsesAt(index),
    security: isSecured(index) ? [SECURITY_REQUIREMENT] : [],
    servers: [],
    runtime: runtimeAt(index, controller, handler),
  };
}

/**
 * The `runtime-collectors` check the collector registry owns, per SPEC 7.2.
 *
 * IT IS NOT A DRIFT RULE AND IT IS PART OF THE PROFILE. One collector of five reported nothing, and
 * the check comes first in the report so a reader knows how much to trust the rest.
 *
 * IT IS SUPPLIED RATHER THAN DERIVED FROM THE DOCUMENT, because the registry that counts it lives in
 * `@openref/nest` and a document carries no record of what the registry was asked for. The figures
 * are the measured ones, so counting the collector names the document below carries would give a
 * different pair and would be counting a different question.
 */
export const maintainerCollectorsCheck: IRHealthCheck = {
  id: 'runtime-collectors',
  label: 'Runtime collectors that reported a fact',
  passed: 4,
  total: 5,
  severity: 'warning',
};

/**
 * The guard to scheme mapping the host configured, which `security-drift` cannot be asked without.
 *
 * IT CARRIES NO `handledNodeIds`, DELIBERATELY. `orphan-operation` answers out of scope while that
 * member is absent, per its own rule, so the profile keeps that row at 0 of 0 while still giving
 * `security-drift` the one input its `CLEAN` arm needs. Without a mapping the rule returns out of
 * scope for every operation that declares security, so its row would read 4 of 4 rather than 22 of
 * 26 and the score would not be the measured one.
 */
export const maintainerObservation: DriftObservation = {
  guardSchemes: new Map([[GUARD_CLASS, SECURITY_SCHEME]]),
};

/**
 * The maintainer's measured application, reconstructed as an IR document.
 *
 * WHAT IT REPRODUCES, exactly, under
 * `buildHealthReport(document, { checks: [maintainerCollectorsCheck], observation:
 * maintainerObservation })`: 58 operations, 180 findings, and a score of 77.
 *
 * | check                     | severity | passed / total | findings |
 * | ------------------------- | -------- | -------------- | -------- |
 * | runtime-collectors        | warning  | 4 / 5          | -        |
 * | security-drift            | error    | 22 / 26        | 4        |
 * | scope-drift               | warning  | 28 / 29        | 1        |
 * | ratelimit-undocumented    | warning  | 0 / 0          | 0        |
 * | stream-unspecified        | error    | 45 / 52        | 7        |
 * | error-undocumented        | warning  | 0 / 0          | 0        |
 * | orphan-operation          | error    | 0 / 0          | 0        |
 * | parameter-unread          | warning  | 45 / 57        | 12       |
 * | header-requiredness-drift | warning  | 23 / 24        | 1        |
 * | status-drift              | error    | 53 / 56        | 3        |
 * | missing-description       | warning  | 58 / 58        | 0        |
 * | missing-example           | info     | 5 / 58         | 53       |
 * | missing-operation-id      | warning  | 0 / 58         | 58       |
 * | dto-field-undescribed     | info     | 432 / 466      | 34       |
 * | operation-key-unread      | warning  | 0 / 0          | 0        |
 * | discovery-incomplete      | warning  | 0 / 7          | 7        |
 *
 * `DX030` at 58 and `DX020` at 53 are the two loudest lines of that table, and they are the pair
 * every note about this application quotes: 58 operation ids the generator produced, and 53 copies
 * of one sentence about a missing example. The four rows at 0 of 0 are rules with no subject in this
 * document, which is a rule staying quiet rather than a rule passing.
 *
 * IT IS A RECONSTRUCTION AND NOT THE APPLICATION. The application is not in this repository. What is
 * rebuilt here is the profile: the same denominators, the same failures and the same score, so the
 * figures the weighting of SPEC 7.2 was chosen against can be re-measured rather than trusted.
 *
 * @returns The document, identical between runs and carrying no clock and no random value
 */
export function maintainerDocument(): IRDocument {
  const operations: readonly IROperation[] = Array.from({ length: OPERATIONS }, (_unused, index) =>
    operationAt(index),
  );
  const schemas: readonly IRSchema[] = Array.from({ length: SCHEMAS }, (_unused, index) =>
    schemaAt(index),
  );

  return {
    id: 'maintainer-application',
    kind: 'http',
    hash: '',
    info: { title: 'Maintainer application', version: '1.0.0' },
    servers: [],
    navigation: [],
    nodes: new Map<string, IRNode>(operations.map((operation) => [operation.id, operation])),
    schemas: new Map<string, IRSchema>(schemas.map((schema) => [schema.id, schema])),
    security: SECURITY_SCHEMES,
    relationships: [],
    webhooks: new Map(),
    runtime: {
      collectors: [
        'guardsCollector',
        'scopesCollector',
        'requiredHeadersCollector',
        'parameterReadsCollector',
        'statusCodeCollector',
        'streamingCollector',
      ],
      // THE SKIPPED ONE IS WHY `ratelimit-undocumented` HAS NO SUBJECT. A collector that could not
      // run is the instrument failing rather than the two sides differing, so it is not a discovery
      // problem, per SPEC 7.1: it is counted by the `runtime-collectors` check and nowhere else.
      skipped: [
        {
          collector: 'throttlerCollector',
          reason: '@nestjs/throttler is not installed, so no rate limit could be read',
        },
      ],
      guardSchemes: { [GUARD_CLASS]: SECURITY_SCHEME },
      problems: DISCOVERY_PROBLEMS,
    },
  };
}
