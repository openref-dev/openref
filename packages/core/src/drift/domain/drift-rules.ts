/**
 * The thirteen rules of SPEC 7.1, each one a check with a quiet state and a suggested fix.
 *
 * A RULE THAT CANNOT STAY QUIET IS NOISE, AND THE OUTCOME TYPE IS WHERE THAT IS ENFORCED. Every
 * check answers one of three things: the subject is outside its scope, the subject is in scope and
 * clean, or the subject is in scope and there is a finding. A rule with no `clean` arm would not
 * compile, and the health check of SPEC 7.2 counts the second and third arms, which is why a rule
 * cannot report a percentage without having said what it is a percentage of.
 *
 * NO RULE DECIDES ITS OWN BUCKET. A check reports what it saw, as the shape of the edit that would
 * be needed and the provenance of the fact behind it; `classifyDrift` turns that into a bucket.
 * That is the correction recorded in `ai-docs/REMEDIATION.md` section 2, and keeping the decision
 * out of the rules is what makes a table from rule id to bucket unwritable rather than forbidden.
 *
 * EVERYTHING HERE IS A PURE FUNCTION OF THE IR. The runtime side of every rule is a fact some
 * collector already attached to the node, so the engine never asks an application anything and
 * runs identically in `doctor`, in the health panel and in a test with a hand built document.
 */

import { isGeneratedOperationId } from '../../normalizer/domain/operation-identity';
import { classifyDrift } from './classification';
import type { IROperation } from '../../ir/domain/node.types';
import type { IRDocument } from '../../ir/domain/document.types';
import type {
  IRDriftBasis,
  IRDriftEdit,
  IRDriftIssue,
  IRDriftRule,
  IRDriftSeverity,
  IRErrorContract,
  IRGuard,
} from '../../ir/domain/runtime.types';
import type { IRConfidence } from '../../ir/domain/confidence.types';
import type { IRJsonSchema } from '../../ir/domain/schema.types';

/**
 * What the runtime pass observed about the application, as far as drift is concerned.
 *
 * IT CARRIES THE NODES THAT WERE HANDLED AND HAS NO FIELD FOR THE ROUTES THAT WERE NOT DOCUMENTED,
 * WHICH IS A DECISION AND NOT AN OMISSION. A route the application serves and the document does
 * not describe is the mirror of `orphan-operation`, and it is not drift: a document built with
 * `include` describes part of an application deliberately, so an undocumented route is the host's
 * choice rather than two sides disagreeing. Leaving it out of this shape means no rule can fire on
 * it by accident, which is stronger than a rule that remembers not to.
 *
 * ITS ABSENCE MEANS NO PASS RAN. Every rule that compares the specification against a running
 * application is then out of scope rather than failing, so a document normalized with no
 * application behind it scores on the questions it can actually be asked.
 */
export interface DriftObservation {
  /** Ids of the document's operations the pass found a handler for. */
  readonly handledNodeIds: ReadonlySet<string>;
  /** Guard class name to security scheme id, exactly as the host configured it, per SPEC 13.2. */
  readonly guardSchemes?: ReadonlyMap<string, string>;
}

/** Everything a check may look at. */
interface RuleContext {
  readonly observation: DriftObservation | undefined;
}

/** What a check found, before the classification is stamped on it. */
interface Finding {
  readonly message: string;
  readonly runtimeValue?: string;
  readonly specValue?: string;
  readonly suggestion: string;
  readonly edit: IRDriftEdit;
  readonly basis: IRDriftBasis;
}

/** One check's verdict about one subject. */
type Outcome =
  | { readonly kind: 'out-of-scope' }
  | { readonly kind: 'clean' }
  | { readonly kind: 'finding'; readonly finding: Finding };

/** One rule of SPEC 7.1 that asks its question of an operation. */
interface OperationRule {
  readonly id: IRDriftRule;
  readonly severity: IRDriftSeverity;
  /** The line this rule contributes to the health report, in the wording of SPEC 7.2. */
  readonly label: string;
  check(operation: IROperation, context: RuleContext): Outcome;
}

/** The subject is not the kind of thing this rule asks about. */
const OUT_OF_SCOPE: Outcome = { kind: 'out-of-scope' };

/** The subject is the kind of thing this rule asks about, and the answer is fine. */
const CLEAN: Outcome = { kind: 'clean' };

/** No runtime fact stands behind this finding. */
const UNOBSERVED: IRDriftBasis = { kind: 'unobserved' };

/**
 * The provenance of a fact a collector produced.
 *
 * @param confidence - How the collector came by it
 * @returns The basis to put on a finding
 */
function collected(confidence: IRConfidence): IRDriftBasis {
  return { kind: 'collected', confidence };
}

/**
 * Wraps a finding in the outcome shape.
 *
 * @param finding - What the check saw
 * @returns The outcome
 */
function found(finding: Finding): Outcome {
  return { kind: 'finding', finding };
}

/**
 * The strongest confidence among the guards standing on a route.
 *
 * THE CLAIM IS EXISTENTIAL, SO THE BEST EVIDENCE CARRIES IT. `security-drift` says "this route is
 * guarded", and one guard named at `declared` makes that true whatever the others were read at.
 * Taking the weakest instead would report a route as less certainly protected than it is known to
 * be, which is the wrong direction for a security rule to err in.
 *
 * @param guards - Every guard observed on the route, which must not be empty
 * @returns The confidence of the best evidence
 */
function strongestConfidence(guards: readonly IRGuard[]): IRConfidence {
  const order: readonly IRConfidence[] = ['declared', 'derived', 'inferred'];

  for (const level of order) {
    if (guards.some((guard) => guard.confidence === level)) return level;
  }

  return 'inferred';
}

/**
 * The rate limit the specification asserts, when it asserts one at all.
 *
 * ONLY A CONSTANT ON A RATE LIMIT HEADER COUNTS, per SPEC 7.1. OpenAPI has no vocabulary for a
 * rate limit, so the one machine readable assertion a document can make about a number is a
 * response header whose schema pins it. A description saying "at most 10 per minute" is prose, and
 * reading a number out of prose is the guess SPEC 6.1 refuses; a document that says nothing
 * checkable is treated as saying nothing, which is the honest reading rather than the convenient
 * one.
 *
 * @param operation - The operation being checked
 * @returns The documented limit, or undefined when the specification asserts none
 */
function documentedRateLimit(operation: IROperation): number | undefined {
  const response = operation.responses.find((candidate) => candidate.statusCode === '429');
  if (response === undefined) return undefined;

  for (const header of response.headers ?? []) {
    const name = header.name.toLowerCase();
    if (name !== 'ratelimit-limit' && name !== 'x-ratelimit-limit') continue;

    const slot = header.schema;
    if (slot?.kind !== 'inline') continue;

    const value = slot.schema.normalized?.const;
    if (typeof value === 'number') return value;
  }

  return undefined;
}

/** Every status code the specification documents for an operation, as written. */
function documentedStatuses(operation: IROperation): ReadonlySet<string> {
  return new Set(operation.responses.map((response) => response.statusCode));
}

/**
 * `security-drift`: a guard stands on the route and the specification does not say so.
 */
const SECURITY_DRIFT: OperationRule = {
  id: 'security-drift',
  severity: 'error',
  label: 'Guarded operations with documented security',

  check(operation: IROperation, context: RuleContext): Outcome {
    const guards = operation.runtime?.guards ?? [];
    if (guards.length === 0) return OUT_OF_SCOPE;

    const basis = collected(strongestConfidence(guards));
    // THE SCOPE TRAVELS WITH THE NAME INTO THE FINDING, per SPEC 6.2.1. A finding reading
    // `ReadonlyGuard` sends a reader to look for `@UseGuards` on a handler that has none, and on
    // an application whose whole policy is one `APP_GUARD` provider that is every finding it
    // produces. The row has to say where to go and look.
    const named = guards
      .map((guard) => (guard.scope === 'global' ? `${guard.name} (application wide)` : guard.name))
      .join(', ');
    const schemes = context.observation?.guardSchemes;
    const mapped = guards
      .map((guard) => schemes?.get(guard.name))
      .filter((scheme): scheme is string => scheme !== undefined);

    if (operation.security.length === 0) {
      return found({
        message: 'A guard stands on this operation and the specification asserts no security.',
        runtimeValue: named,
        specValue: 'security: undefined',
        suggestion:
          mapped.length === 0
            ? 'add @ApiBearerAuth() or declare security in DocumentBuilder'
            : `add the decorator for the security scheme "${mapped[0] ?? ''}" to the handler, ` +
              'for example @ApiBearerAuth(name), or declare it in DocumentBuilder',
        edit: 'new-assertion',
        basis,
      });
    }

    // WITHOUT A MAPPING THIS RULE HAS NOTHING TO COMPARE, so it is out of scope rather than clean.
    // A guard class name does not name a security scheme, per SPEC 7.1, and firing here would mean
    // asserting a disagreement nobody measured. IT WAS `CLEAN` UNTIL T035, and that is the stronger
    // claim of the two: `CLEAN` is what the parity scale reads as "a rule examined this and stayed
    // quiet", so the authentication row drew `=` over a comparison that never happened, on every
    // operation with a guard and a declared requirement. Out of scope is what did happen, and it
    // also stops the health check counting an operation it never compared among the ones it passed.
    if (mapped.length === 0) return OUT_OF_SCOPE;

    const required = operation.security.map((requirement) => requirement.schemeId);
    if (required.some((schemeId) => mapped.includes(schemeId))) return CLEAN;

    return found({
      message: 'The guard on this operation maps to a scheme the specification does not require.',
      runtimeValue: `${named} -> ${mapped.join(', ')}`,
      specValue: `security: ${required.join(', ')}`,
      suggestion:
        'correct whichever side is wrong by hand: either the guard on the handler or the ' +
        'security requirement in DocumentBuilder. A conflicting assertion is never rewritten',
      edit: 'conflicting-assertion',
      basis,
    });
  },
};

/**
 * `scope-drift`: the code says which scopes a route needs and the security requirement does not.
 */
const SCOPE_DRIFT: OperationRule = {
  id: 'scope-drift',
  severity: 'warning',
  label: 'Declared scopes reflected in the security requirement',

  check(operation: IROperation): Outcome {
    const scopes = operation.runtime?.scopes;
    if (scopes === undefined || scopes.value.length === 0) return OUT_OF_SCOPE;

    // A ROUTE WITH NO SECURITY REQUIREMENT IS `security-drift`'S SUBJECT AND NOT THIS RULE'S. The
    // same silence reported twice reads as two problems, and only one of them has an edit.
    if (operation.security.length === 0) return OUT_OF_SCOPE;

    const listed = new Set(operation.security.flatMap((requirement) => requirement.scopes));
    const missing = scopes.value.filter((scope) => !listed.has(scope));
    if (missing.length === 0) return CLEAN;

    return found({
      message: 'Scopes are declared in code and the security requirement does not list them.',
      runtimeValue: missing.join(', '),
      specValue: operation.security
        .map((requirement) => `${requirement.schemeId}: [${requirement.scopes.join(', ')}]`)
        .join('; '),
      suggestion:
        `add @ApiOAuth2([${missing.map((scope) => `'${scope}'`).join(', ')}]) to the handler, ` +
        'or list the scopes on the security requirement in DocumentBuilder',
      edit: 'narrowed-assertion',
      basis: collected(scopes.confidence),
    });
  },
};

/**
 * `ratelimit-undocumented`: a limit is enforced and the specification is silent or disagrees.
 */
const RATELIMIT_UNDOCUMENTED: OperationRule = {
  id: 'ratelimit-undocumented',
  severity: 'warning',
  label: 'Rate limited operations documenting 429',

  check(operation: IROperation): Outcome {
    const rateLimit = operation.runtime?.rateLimit;
    if (rateLimit === undefined) return OUT_OF_SCOPE;

    const basis = collected(rateLimit.confidence);
    const enforced = rateLimit.value.limit;
    const window = `${String(rateLimit.value.ttlMs)} ms`;
    const runtimeValue = `${String(enforced)} request(s) per ${window}`;

    if (!documentedStatuses(operation).has('429')) {
      return found({
        message: 'A rate limit is applied to this operation and no 429 is documented.',
        runtimeValue,
        specValue: 'no 429 response',
        suggestion:
          "add @ApiResponse({ status: 429, description: 'Too Many Requests' }) to the handler",
        edit: 'new-assertion',
        basis,
      });
    }

    const documented = documentedRateLimit(operation);
    if (documented === undefined || documented === enforced) return CLEAN;

    return found({
      message: 'The documented rate limit disagrees with the one the application applies.',
      runtimeValue,
      specValue: `${String(documented)} request(s), from the rate limit response header`,
      suggestion:
        'correct whichever side is wrong by hand: either the throttler on the handler or the ' +
        'RateLimit-Limit response header. Two numbers disagreeing is not a silence to fill',
      edit: 'conflicting-assertion',
      basis,
    });
  },
};

/**
 * `stream-unspecified`: the route streams and nothing states what it streams.
 */
const STREAM_UNSPECIFIED: OperationRule = {
  id: 'stream-unspecified',
  severity: 'error',
  label: 'Streaming operations with an item schema',

  check(operation: IROperation): Outcome {
    const streaming = operation.runtime?.streaming;
    if (streaming === undefined) return OUT_OF_SCOPE;

    const transport = streaming.value.transport;
    const item = streaming.value.itemSchema;

    if (item !== undefined && streaming.confidence !== 'inferred') return CLEAN;

    if (item === undefined) {
      return found({
        message: 'This operation streams and nothing states what it streams.',
        runtimeValue: transport,
        specValue: 'no itemSchema on any response',
        suggestion:
          'add @ApiStream({ itemType: YourDto }) to the handler. A type parameter does not ' +
          'survive compilation, so nothing at runtime can recover it',
        edit: 'nothing-to-write',
        basis: UNOBSERVED,
      });
    }

    // THE ITEM TYPE IS KNOWN AND ONLY AT `inferred`, which is the confidence starvation of
    // REMEDIATION section 2 rather than an absence. Writing the plugin's guess into source as an
    // explicit decorator would promote it to `declared` irreversibly, per SPEC 7.4.
    return found({
      message: 'The item type of this stream is known only at inferred confidence.',
      runtimeValue: `${transport}, item type inferred by the compile time plugin`,
      specValue: 'no itemSchema on any response',
      suggestion:
        'add @ApiStream({ itemType: YourDto }) to the handler, so the item type is declared ' +
        'rather than inferred',
      edit: 'new-assertion',
      basis: collected(streaming.confidence),
    });
  },
};

/**
 * `error-undocumented`: an error the handler promises has no response in the document.
 */
const ERROR_UNDOCUMENTED: OperationRule = {
  id: 'error-undocumented',
  severity: 'warning',
  label: 'Declared errors with a documented response',

  check(operation: IROperation): Outcome {
    const declared = operation.runtime?.errors?.declared ?? [];
    if (declared.length === 0) return OUT_OF_SCOPE;

    const documented = documentedStatuses(operation);
    const missing = declared.filter(
      (contract: IRErrorContract) =>
        !documented.has(String(contract.status)) && !documented.has('default'),
    );
    if (missing.length === 0) return CLEAN;

    const statuses = [...new Set(missing.map((contract) => String(contract.status)))];
    const weakest = missing.some((contract) => contract.confidence === 'inferred')
      ? 'inferred'
      : (missing[0]?.confidence ?? 'declared');

    return found({
      message: 'An error is declared on this operation and no response documents it.',
      runtimeValue: statuses.join(', '),
      specValue: [...documented].join(', '),
      suggestion:
        `the handler already declares ${statuses.join(', ')} with @ApiErrors, so the gap is in ` +
        'the generated document rather than in the source. Check how the document is generated, ' +
        `or add @ApiResponse({ status: ${statuses[0] ?? ''} }) beside it`,
      edit: 'already-asserted',
      basis: collected(weakest),
    });
  },
};

/**
 * `orphan-operation`: the document describes a route the application does not serve.
 */
const ORPHAN_OPERATION: OperationRule = {
  id: 'orphan-operation',
  severity: 'error',
  label: 'Documented operations the application serves',

  check(operation: IROperation, context: RuleContext): Outcome {
    const observation = context.observation;
    if (observation === undefined) return OUT_OF_SCOPE;
    if (observation.handledNodeIds.has(operation.id)) return CLEAN;

    return found({
      message: 'The specification describes this operation and no handler was found for it.',
      runtimeValue: 'no handler',
      specValue: `${operation.method.toUpperCase()} ${operation.path}`,
      suggestion:
        'restore the handler, or remove the operation from the specification by hand. Nothing ' +
        'is deleted automatically: deleting documentation is how a removed endpoint stops ' +
        'being noticed',
      edit: 'deleted-assertion',
      basis: UNOBSERVED,
    });
  },
};

/**
 * `parameter-unread`: a parameter is declared and the scan did not see the handler read it.
 *
 * IT FIRES ON `not-seen-read` AND NEVER ON `unaccounted`, which is the distinction SPEC 6.2.1
 * requires the fact to carry: a parameter the scan did not see read is not a parameter that is
 * unread, it is one the scan did not see, and a rule firing on the scan's own blindness would
 * tell a reader to delete documentation the instrument merely failed to check.
 *
 * A HEADER THE `requiredHeaders` FACT NAMES COUNTS AS READ. The guard reading it is the
 * application reading it, and the handler is not the only code a request passes through.
 */
const PARAMETER_UNREAD: OperationRule = {
  id: 'parameter-unread',
  severity: 'warning',
  label: 'Declared parameters the handler was seen to read',

  check(operation: IROperation): Outcome {
    const reads = operation.runtime?.parameterReads;
    if (reads === undefined) return OUT_OF_SCOPE;

    // A SCAN THAT ACCOUNTED FOR NOTHING EXAMINED NOTHING, per T035. `unaccounted` is the scan
    // speaking about itself, and a fact made only of it is a fact with no observation in it; this
    // rule returned `CLEAN` for that until T035, and the parity row turned that into `=` while the
    // cell beside it said `0 of 1 seen read, 1 not accounted for by the scan`. The two now agree.
    if (
      reads.value.parameters.length > 0 &&
      reads.value.parameters.every((parameter) => parameter.verdict === 'unaccounted')
    ) {
      return OUT_OF_SCOPE;
    }

    const required = new Set(
      (operation.runtime?.requiredHeaders?.value ?? []).map((name) => name.toLowerCase()),
    );
    const unread = reads.value.parameters.filter(
      (parameter) =>
        parameter.verdict === 'not-seen-read' &&
        !(parameter.in === 'header' && required.has(parameter.name.toLowerCase())),
    );
    if (unread.length === 0) return CLEAN;

    const names = unread.map((parameter) => `${parameter.in} ${parameter.name}`);

    return found({
      message:
        'Parameters are declared on this operation and the scan saw the handler read none of them.',
      runtimeValue: `not seen read: ${names.join(', ')}`,
      specValue: `${String(operation.parameters.length)} parameter(s) declared`,
      suggestion:
        'remove the parameter from the specification by hand, or implement reading it. Which ' +
        'side is wrong is not knowable here: the scan accounted for every access path of these ' +
        'locations, and a parameter it could not account for is never reported',
      // THE ONLY EDIT THAT WOULD SATISFY THE RULE DELETES AN EXISTING ASSERTION, so this is a
      // contradiction by SPEC 7.4 and no fix mode touches it at any confidence, which is also
      // what an `inferred` basis would force one branch later.
      edit: 'deleted-assertion',
      basis: collected(reads.confidence),
    });
  },
};

/**
 * `header-requiredness-drift`: the runtime requires a header and the specification disagrees.
 */
const HEADER_REQUIREDNESS_DRIFT: OperationRule = {
  id: 'header-requiredness-drift',
  severity: 'warning',
  label: 'Headers the runtime requires documented as required',

  check(operation: IROperation): Outcome {
    const fact = operation.runtime?.requiredHeaders;
    if (fact === undefined || fact.value.length === 0) return OUT_OF_SCOPE;

    // HEADER NAMES COMPARE CASE INSENSITIVELY, because HTTP headers do. The document's own
    // spelling is kept for display; only the comparison folds.
    const declared = new Map(
      operation.parameters
        .filter((parameter) => parameter.in === 'header')
        .map((parameter) => [parameter.name.toLowerCase(), parameter.required]),
    );

    const optional: string[] = [];
    const missing: string[] = [];
    for (const name of fact.value) {
      const held = declared.get(name.toLowerCase());
      if (held === undefined) missing.push(name);
      else if (!held) optional.push(name);
    }
    if (optional.length === 0 && missing.length === 0) return CLEAN;

    // A CONFLICT OUTRANKS A SILENCE WHEN ONE FINDING CARRIES BOTH. `required: false` is an
    // assertion the runtime contradicts; an undeclared header is a silence beside it. The edit
    // shape must be the one a fix mode may not touch, or the conflicting half would ride into
    // source under the silent half's classification.
    const conflicted = optional.length > 0;

    return found({
      message: conflicted
        ? 'The runtime requires a header the specification marks optional.'
        : 'The runtime requires a header the specification does not declare.',
      runtimeValue: `required, from guard metadata: ${fact.value.join(', ')}`,
      specValue:
        optional.length > 0
          ? optional.map((name) => `${name}: required false`).join(', ')
          : `not declared: ${missing.join(', ')}`,
      suggestion: conflicted
        ? 'correct whichever side is wrong by hand: either required: true on the header ' +
          'parameter or the guard that refuses without it. A conflicting assertion is never ' +
          'rewritten'
        : `add @ApiHeader({ name: '${missing[0] ?? ''}', required: true }) to the handler, or ` +
          'stop the guard requiring it',
      edit: conflicted ? 'conflicting-assertion' : 'new-assertion',
      basis: collected(fact.confidence),
    });
  },
};

/**
 * `status-drift`: the handler's explicit status code has no documented response.
 *
 * ONLY THE EXPLICIT `@HttpCode` IS IN SCOPE. A framework default is behaviour, not a decision
 * written on the route, so the fact is absent without the decorator and this rule stays quiet
 * on every ordinary operation, per SPEC 7.1.
 */
const STATUS_DRIFT: OperationRule = {
  id: 'status-drift',
  severity: 'error',
  label: 'Explicit status codes with a documented response',

  check(operation: IROperation): Outcome {
    const fact = operation.runtime?.statusCode;
    if (fact === undefined) return OUT_OF_SCOPE;

    const documented = documentedStatuses(operation);
    const code = String(fact.value);
    if (documented.has(code) || documented.has('default')) return CLEAN;

    const successes = [...documented].filter((status) => /^2\d\d$/.test(status));
    if (successes.length > 0) {
      return found({
        message:
          'The handler answers an explicit status code and the specification documents a different success.',
        runtimeValue: `@HttpCode(${code})`,
        specValue: successes.join(', '),
        suggestion:
          `correct whichever side is wrong by hand: either @HttpCode(${code}) on the handler ` +
          `or the documented ${successes.join(', ')}. A conflicting assertion is never rewritten`,
        edit: 'conflicting-assertion',
        basis: collected(fact.confidence),
      });
    }

    return found({
      message: 'The handler answers an explicit status code and no response documents it.',
      runtimeValue: `@HttpCode(${code})`,
      specValue: 'no success response documented',
      suggestion: `add @ApiResponse({ status: ${code} }) to the handler`,
      edit: 'new-assertion',
      basis: collected(fact.confidence),
    });
  },
};

/**
 * `missing-description`: the operation says nothing about itself.
 */
const MISSING_DESCRIPTION: OperationRule = {
  id: 'missing-description',
  severity: 'warning',
  label: 'Operations with a description',

  check(operation: IROperation): Outcome {
    if (operation.description !== undefined || operation.summary !== undefined) return CLEAN;

    return found({
      message: 'This operation has neither a summary nor a description.',
      suggestion: 'add @ApiOperation({ summary, description }) to the handler',
      edit: 'nothing-to-write',
      basis: UNOBSERVED,
    });
  },
};

/**
 * `missing-example`: no body of the operation carries a written example.
 */
const MISSING_EXAMPLE: OperationRule = {
  id: 'missing-example',
  severity: 'info',
  label: 'Operations with an example',

  check(operation: IROperation): Outcome {
    const media = [
      ...(operation.requestBody?.content ?? []),
      ...operation.responses
        .filter((response) => /^2\d\d$/.test(response.statusCode))
        .flatMap((response) => response.content),
    ];
    if (media.length === 0) return OUT_OF_SCOPE;
    if (media.some((entry) => entry.example !== undefined || entry.examples !== undefined)) {
      return CLEAN;
    }

    return found({
      message: 'No request or response body of this operation carries an example.',
      suggestion:
        'add example or examples to the media type, for example @ApiResponse({ example }). The ' +
        'renderer generates one from the schema meanwhile, so this asks for what a schema ' +
        'cannot say',
      edit: 'nothing-to-write',
      basis: UNOBSERVED,
    });
  },
};

/**
 * `missing-operation-id`: the public name of the operation is whatever the generator produced.
 */
const MISSING_OPERATION_ID: OperationRule = {
  id: 'missing-operation-id',
  severity: 'warning',
  label: 'Operations with a stable operationId',

  check(operation: IROperation): Outcome {
    const raw = operation.rawOperationId;
    if (raw !== undefined && raw !== '' && !isGeneratedOperationId(raw)) return CLEAN;

    const source = operation.runtime?.source;
    const absent = raw === undefined || raw === '';
    const specValue = absent ? 'no operationId' : raw;

    // THE MESSAGE SAYS WHICH OF THE TWO IT IS, FOUND IN T025. It read "gives this operation no
    // stable operationId" for both, so on a `@nestjs/swagger` document, where every operation has
    // a generated one, every finding printed a sentence saying there is no id beside a column
    // holding the id. A reader who checks is told the reference cannot see what they can, and the
    // edit the row asks for is a different edit in the two cases.
    const message = absent
      ? 'The specification gives this operation no operationId at all.'
      : 'The operationId is the one the generator produced, so it changes when the method does.';

    if (source === undefined) {
      return found({
        message,
        specValue,
        suggestion: "add @ApiOperation({ operationId: 'yourName' }) to the handler",
        edit: 'nothing-to-write',
        basis: UNOBSERVED,
      });
    }

    // THE PAIR IS AT `declared` BECAUSE THERE IS NOTHING TO BE UNCERTAIN ABOUT, which is the same
    // reading SPEC 6.3 gives `source` when it says that field carries no confidence: the class
    // name and the method name are read literally rather than worked out.
    return found({
      message,
      runtimeValue: `${source.controller}.${source.handler}`,
      specValue,
      suggestion:
        `add @ApiOperation({ operationId: '${source.handler}' }) to the handler, so the public ` +
        'name does not change with whatever the generator produces next version',
      edit: 'new-assertion',
      basis: collected('declared'),
    });
  },
};

/**
 * Every rule that asks its question of an operation, in report order.
 *
 * THE ORDER IS THE ORDER OF SPEC 7.1 and it is fixed, because the drift list goes into the IR and
 * the IR is hashed. A set iterated in whatever order the runtime chose would give one application
 * two hashes.
 */
export const OPERATION_DRIFT_RULES: readonly OperationRule[] = [
  SECURITY_DRIFT,
  SCOPE_DRIFT,
  RATELIMIT_UNDOCUMENTED,
  STREAM_UNSPECIFIED,
  ERROR_UNDOCUMENTED,
  ORPHAN_OPERATION,
  PARAMETER_UNREAD,
  HEADER_REQUIREDNESS_DRIFT,
  STATUS_DRIFT,
  MISSING_DESCRIPTION,
  MISSING_EXAMPLE,
  MISSING_OPERATION_ID,
];

/** The rule that asks its question of a schema field rather than of an operation. */
export const DTO_FIELD_RULE = {
  id: 'dto-field-undescribed' as const,
  severity: 'info' as const,
  label: 'DTO fields with a description',
};

/**
 * How deep a schema is walked while looking for undescribed fields.
 *
 * The normalizer already bounds nesting, and references stay references rather than being
 * inlined, so nothing produced by this package can reach this. It bounds a hand built document.
 */
export const MAX_DTO_FIELD_DEPTH = 16;

/** One field of one schema, as the walk found it. */
interface Field {
  readonly schemaId: string;
  readonly pointer: string;
  readonly schema: IRJsonSchema;
}

/**
 * Walks the fields of one schema.
 *
 * A FIELD WHOSE SCHEMA IS A REFERENCE IS DESCRIBED BY ITS TYPE AND IS NOT VISITED. Per SPEC 5.1.1
 * a reference node carries nothing but annotations, so it has no description of its own to lack,
 * and the schema it names is a named schema this walk reaches separately. Reporting both would
 * report one missing sentence once per use site.
 *
 * @param schemaId - Id of the named schema being walked
 * @param schema - The schema at this position
 * @param pointer - JSON pointer to this position, relative to the named schema
 * @param depth - How far down the walk already is
 * @param into - The list being filled
 */
function walkFields(
  schemaId: string,
  schema: IRJsonSchema,
  pointer: string,
  depth: number,
  into: Field[],
): void {
  if (depth > MAX_DTO_FIELD_DEPTH) return;
  if (schema.$ref !== undefined || schema.$cycle !== undefined) return;

  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const at = `${pointer}/properties/${name}`;
    if (property.$ref === undefined && property.$cycle === undefined) {
      into.push({ schemaId, pointer: at, schema: property });
    }
    walkFields(schemaId, property, at, depth + 1, into);
  }

  if (schema.items !== undefined) {
    walkFields(schemaId, schema.items, `${pointer}/items`, depth + 1, into);
  }
}

/**
 * Every field of every named schema in the document, in document order.
 *
 * @param document - The document being checked
 * @returns The fields, each with the pointer that names it
 */
function documentFields(document: IRDocument): readonly Field[] {
  const fields: Field[] = [];

  for (const [id, schema] of document.schemas) {
    const normalized = schema.normalized;
    if (normalized === undefined) continue;

    walkFields(id, normalized, '', 0, fields);
  }

  return fields;
}

/**
 * Turns a check's finding into the issue that goes into the report.
 *
 * THE CLASSIFICATION IS STAMPED HERE AND NOWHERE ELSE, which is what makes a rule unable to
 * declare its own bucket even by accident: a rule has no way to reach `IRDriftIssue` except
 * through this function, and this function computes the bucket from what the rule observed.
 *
 * @param rule - Which check produced it
 * @param subject - The node or schema and pointer the finding is about
 * @param finding - What the check saw
 * @returns The issue
 */
function issueOf(
  rule: { readonly id: IRDriftRule; readonly severity: IRDriftSeverity },
  subject: { readonly nodeId?: string; readonly schemaId?: string; readonly pointer?: string },
  finding: Finding,
): IRDriftIssue {
  return {
    rule: rule.id,
    severity: rule.severity,
    ...(subject.nodeId === undefined ? {} : { nodeId: subject.nodeId }),
    ...(subject.schemaId === undefined ? {} : { schemaId: subject.schemaId }),
    ...(subject.pointer === undefined ? {} : { pointer: subject.pointer }),
    message: finding.message,
    ...(finding.runtimeValue === undefined ? {} : { runtimeValue: finding.runtimeValue }),
    ...(finding.specValue === undefined ? {} : { specValue: finding.specValue }),
    suggestion: finding.suggestion,
    classification: classifyDrift(finding.edit, finding.basis),
    edit: finding.edit,
    basis: finding.basis,
  };
}

/** What one rule found across the whole document. */
export interface RuleResult {
  readonly rule: IRDriftRule;
  readonly severity: IRDriftSeverity;
  readonly label: string;
  /** Subjects the rule applies to. */
  readonly total: number;
  /** Subjects it stayed quiet about. */
  readonly passed: number;
  readonly issues: readonly IRDriftIssue[];
}

/**
 * Runs every rule of SPEC 7.1 over one document.
 *
 * @param document - The document, with whatever runtime facts are attached to it
 * @param observation - What the runtime pass saw, when one ran
 * @returns One result per rule, in the order of SPEC 7.1
 */
export function runDriftRules(
  document: IRDocument,
  observation?: DriftObservation,
): readonly RuleResult[] {
  const context: RuleContext = { observation };
  const operations: IROperation[] = [];
  for (const node of document.nodes.values()) {
    if (node.kind === 'operation') operations.push(node);
  }

  const results: RuleResult[] = OPERATION_DRIFT_RULES.map((rule) => {
    const issues: IRDriftIssue[] = [];
    let total = 0;
    let passed = 0;

    for (const operation of operations) {
      const outcome = rule.check(operation, context);
      if (outcome.kind === 'out-of-scope') continue;

      total += 1;
      if (outcome.kind === 'clean') passed += 1;
      else issues.push(issueOf(rule, { nodeId: operation.id }, outcome.finding));
    }

    return { rule: rule.id, severity: rule.severity, label: rule.label, total, passed, issues };
  });

  results.push(dtoFieldResult(document));

  return results;
}

/**
 * The one rule whose subject is a schema field.
 *
 * @param document - The document being checked
 * @returns Its result, shaped like every other rule's
 */
function dtoFieldResult(document: IRDocument): RuleResult {
  const fields = documentFields(document);
  const issues: IRDriftIssue[] = [];

  for (const field of fields) {
    if (field.schema.description !== undefined) continue;

    issues.push(
      issueOf(
        DTO_FIELD_RULE,
        { schemaId: field.schemaId, pointer: field.pointer },
        {
          message: 'This field has no description.',
          suggestion: 'add @ApiProperty({ description }) to the property',
          edit: 'nothing-to-write',
          basis: UNOBSERVED,
        },
      ),
    );
  }

  return {
    rule: DTO_FIELD_RULE.id,
    severity: DTO_FIELD_RULE.severity,
    label: DTO_FIELD_RULE.label,
    total: fields.length,
    passed: fields.length - issues.length,
    issues,
  };
}

/** What one rule answered about one operation, which is `Outcome` without the finding's body. */
export type OperationRuleOutcome = 'clean' | 'finding' | 'out-of-scope';

/**
 * Asks one rule of SPEC 7.1 its question about one operation.
 *
 * THIS EXISTS SO A RENDERER NEVER COPIES A SCOPE PREDICATE. The parity scale of TX-GUTTER
 * distinguishes "the rule looked and stayed quiet" from "the rule does not apply here", which is
 * exactly the tri-state each check already computes and `runDriftRules` collapses into counts.
 * Re-asking the same rule object is one source of truth; a second table of "when does
 * `scope-drift` apply" would come to disagree with the first the day either changed.
 *
 * WITHOUT AN OBSERVATION IT ANSWERS WHAT CAN BE KNOWN WITHOUT ONE, which is what a render time
 * caller has. `orphan-operation` is then out of scope, per its own definition, and
 * `security-drift` loses only the guard-to-scheme comparison, whose findings a caller reads from
 * the recorded report rather than from this.
 *
 * @param operation - The operation being asked about
 * @param rule - Which rule asks
 * @param observation - What the runtime pass saw, when the caller has one
 * @returns The outcome kind; `out-of-scope` for the one rule whose subject is not an operation
 */
export function operationRuleOutcome(
  operation: IROperation,
  rule: IRDriftRule,
  observation?: DriftObservation,
): OperationRuleOutcome {
  const asked = OPERATION_DRIFT_RULES.find((candidate) => candidate.id === rule);
  if (asked === undefined) return 'out-of-scope';

  return asked.check(operation, { observation }).kind;
}
