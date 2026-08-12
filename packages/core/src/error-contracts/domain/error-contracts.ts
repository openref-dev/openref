/**
 * Error contracts, per SPEC 6.4: the RFC 9457 shape, the three groups, and the one derivation.
 *
 * IT IS IN `core` BECAUSE IT HAS TWO CONSUMERS AND NEEDS NEITHER OF THEM. `nest` builds the
 * declared group out of a decorator and runs the derivation after its collectors have merged;
 * `render` shows what came out. The same reasoning put `expandSourceLink` here in T018, and the
 * same constraint applies: nothing below imports NestJS, Vue or the DOM, so all of it is testable
 * against a document with no application behind it.
 *
 * THE DERIVATION RUNS AFTER THE MERGE AND NOT INSIDE A COLLECTOR, which is a consequence of SPEC
 * 6.2 rather than a preference. 429 follows from a rate limit and 401 and 403 follow from guards,
 * and both of those facts are produced by other collectors, one of them from a package that ships
 * separately. A collector reading another collector's output would make the result depend on
 * registration order, and SPEC 6.2 states that independent collectors cannot be reordered and has
 * a test that runs a pair both ways. Deriving from the merged record instead keeps that true and
 * costs nothing: what the derivation reads is exactly what the reader will see.
 *
 * NOTHING HERE INVENTS A CONTRACT. Every function below either restates something that was
 * declared or reports a consequence of a fact that is present. No fact, no contract, and the
 * absence is what `doctor` reports in T022.
 */

import type { IRConfidence } from '../../ir/domain/confidence.types';
import type { IRJsonSchema } from '../../ir/domain/schema.types';
import type {
  IRErrorContract,
  IRErrorContractOrigin,
  IRErrorContracts,
  IRNodeRuntime,
} from '../../ir/domain/runtime.types';

/** The media type RFC 9457 defines, named once so nothing spells it a second way. */
export const PROBLEM_JSON_MEDIA_TYPE = 'application/problem+json';

/** The three groups with nothing in any of them, which is what an examined route with no errors has. */
export const EMPTY_ERROR_CONTRACTS: IRErrorContracts = {
  declared: [],
  runtimeDerived: [],
  global: [],
};

/** Which field of {@link IRErrorContracts} an origin belongs to. */
const GROUP_OF: Readonly<Record<IRErrorContractOrigin, keyof IRErrorContracts>> = {
  declared: 'declared',
  'runtime-derived': 'runtimeDerived',
  global: 'global',
};

/**
 * Names the group a contract belongs to.
 *
 * THE ONLY PLACE THAT DECIDES THIS. `IRErrorContract.origin` and the field a contract sits in are
 * two spellings of one fact, so exactly one function is allowed to translate between them; every
 * other route to a group is a chance for the two to disagree in a way nothing would notice.
 *
 * @param origin - Where the contract came from
 * @returns The field of {@link IRErrorContracts} it belongs in
 */
export function errorContractGroup(origin: IRErrorContractOrigin): keyof IRErrorContracts {
  return GROUP_OF[origin];
}

/**
 * Sorts loose contracts into the three groups.
 *
 * @param contracts - Contracts in any order, each carrying its own origin
 * @returns The three groups, each in the order the contracts arrived
 */
export function groupErrorContracts(contracts: readonly IRErrorContract[]): IRErrorContracts {
  const declared: IRErrorContract[] = [];
  const runtimeDerived: IRErrorContract[] = [];
  const global: IRErrorContract[] = [];
  const into: Readonly<Record<keyof IRErrorContracts, IRErrorContract[]>> = {
    declared,
    runtimeDerived,
    global,
  };

  for (const contract of contracts) into[errorContractGroup(contract.origin)].push(contract);

  return { declared, runtimeDerived, global };
}

/**
 * Reports whether any group holds anything.
 *
 * @param contracts - The three groups
 * @returns True when at least one group has a member
 */
export function hasErrorContracts(contracts: IRErrorContracts): boolean {
  return contracts.declared.length + contracts.runtimeDerived.length + contracts.global.length > 0;
}

/**
 * Builds the RFC 9457 body shape.
 *
 * ALL FIVE MEMBERS ARE OPTIONAL, WHICH IS THE RFC'S OWN RULE rather than a looseness of this
 * implementation: section 3.1 of RFC 9457 says a consumer must not rely on any member being
 * present, and extension members are explicitly allowed, which is why `additionalProperties` stays
 * open. A schema that marked `status` required would describe a stricter format than the one the
 * media type names.
 *
 * GIVEN A CONTRACT, THE KNOWN MEMBERS ARE PINNED WITH `const`, and that is a restatement rather
 * than a guess: a contract that says 404 describes a body whose `status` is 404, and writing it as
 * a constant is what lets an example generator produce something a reader can compare against.
 * Nothing that was not declared is filled in.
 *
 * @param contract - The contract this body belongs to, when there is one
 * @returns The schema
 */
export function problemDetailsSchema(contract?: IRErrorContract): IRJsonSchema {
  const type: IRJsonSchema =
    contract?.type === undefined
      ? { type: 'string', format: 'uri-reference' }
      : { type: 'string', format: 'uri-reference', const: contract.type };
  const title: IRJsonSchema =
    contract === undefined ? { type: 'string' } : { type: 'string', const: contract.title };
  const status: IRJsonSchema =
    contract === undefined ? { type: 'integer' } : { type: 'integer', const: contract.status };
  const detail: IRJsonSchema =
    contract?.detail === undefined
      ? { type: 'string' }
      : { type: 'string', const: contract.detail };

  return {
    title: 'Problem Details',
    description: 'RFC 9457 problem details, served as application/problem+json.',
    type: 'object',
    properties: {
      type: { ...type, description: 'URI identifying the problem type.' },
      title: { ...title, description: 'Short human readable summary of the problem type.' },
      status: { ...status, description: 'HTTP status code of this response.' },
      detail: { ...detail, description: 'Explanation specific to this occurrence.' },
      instance: {
        type: 'string',
        format: 'uri-reference',
        description: 'URI identifying this occurrence.',
      },
    },
    additionalProperties: true,
  };
}

/** How a derived contract is spelled before it is stamped with its source. */
interface Derivation {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly collector: string;
}

/**
 * Reads the contracts that follow from facts already collected about a route.
 *
 * TWO RULES, PER SPEC 6.4, AND NEITHER OF THEM READS ANY CODE.
 *
 * - a rate limit is present, so the route answers 429. A throttler that is enforced does exactly
 *   that, and the limit and window are restated in the detail
 * - guards are present, so the route can refuse before the handler runs, and HTTP spells that
 *   refusal 401 or 403. This says nothing about what any guard decides: guard logic is never read,
 *   per SPEC 6.1, and which of the two a given request gets is a property of the request
 *
 * THE COLLECTOR NAMED ON EACH CONTRACT IS THE ONE THAT SUPPLIED THE SOURCE FACT, not this
 * function. A reader who sees 429 and wants to know why is looking for `throttlerCollector`, which
 * is the thing that has something to show them; a name for the derivation would be a level of
 * indirection with nothing behind it.
 *
 * @param runtime - The merged facts of one node
 * @returns The runtime derived contracts, in a stable order, empty when no fact supports one
 */
export function deriveRuntimeErrorContracts(runtime: IRNodeRuntime): readonly IRErrorContract[] {
  const derivations: Derivation[] = [];
  const rateLimit = runtime.rateLimit;

  if (rateLimit !== undefined) {
    const window = `${String(rateLimit.value.ttlMs)} ms`;
    derivations.push({
      status: 429,
      title: 'Too Many Requests',
      detail:
        `A rate limit of ${String(rateLimit.value.limit)} request(s) per ${window} is applied ` +
        'to this route, so it can refuse a caller that exceeds it.',
      collector: rateLimit.collector,
    });
  }

  const guards = runtime.guards ?? [];
  if (guards.length > 0) {
    const named = guards.map((guard) => guard.name).join(', ');
    const collector = guards[0]?.collector ?? '';

    derivations.push(
      {
        status: 401,
        title: 'Unauthorized',
        detail:
          `This route is behind ${named}, so it can refuse a caller before the handler runs. ` +
          'What the guard decides is written in its own code and is never read.',
        collector,
      },
      {
        status: 403,
        title: 'Forbidden',
        detail:
          `This route is behind ${named}, so it can refuse a caller before the handler runs. ` +
          'What the guard decides is written in its own code and is never read.',
        collector,
      },
    );
  }

  return derivations.map((derivation) => contractOf(derivation, 'runtime-derived', 'derived'));
}

/**
 * Fills in the parts every contract carries the same way.
 *
 * @param derivation - What the rule produced
 * @param origin - Which group it belongs to
 * @param confidence - How it was come by
 * @returns The contract
 */
function contractOf(
  derivation: Derivation,
  origin: IRErrorContractOrigin,
  confidence: IRConfidence,
): IRErrorContract {
  return {
    status: derivation.status,
    title: derivation.title,
    detail: derivation.detail,
    origin,
    confidence,
    collector: derivation.collector,
    schema: {
      kind: 'inline',
      schema: {
        id: `problem-${String(derivation.status)}`,
        dialect: 'json-schema-2020-12',
        normalized: problemDetailsSchema({
          status: derivation.status,
          title: derivation.title,
          detail: derivation.detail,
          origin,
          confidence,
          collector: derivation.collector,
        }),
      },
    },
  };
}

/**
 * Puts the runtime derived group onto a node's facts, leaving the other two alone.
 *
 * IT WRITES ONE FIELD OF THE THREE, WHICH IS WHY IT CAN RUN AFTER THE MERGE WITHOUT ARGUING WITH
 * IT. The declared and global groups belong to whatever collector produced them, and a function
 * that rebuilt the whole record would be free to lose them; this one cannot, because the other two
 * are copied across by name.
 *
 * IT DOES NOTHING TO A NODE THAT HAS NO `errors` RECORD YET, AND THAT REFUSAL IS THE POINT. The
 * record is present exactly when an error collector examined the route, per SPEC 6.4, and an empty
 * `declared` group inside it is a claim: examined, nothing declared. A derivation that created the
 * record on its own would put that claim on every guarded route in an application that never
 * registered `errorsCollector`, where nobody read a declaration at all. A rate limit with no error
 * collector beside it therefore yields no 429, which is the collector model working: no collector,
 * no facts.
 *
 * @param runtime - The merged facts of one node
 * @returns The same facts with `errors.runtimeDerived` filled in, or unchanged when nobody asked
 */
export function withRuntimeErrorContracts(runtime: IRNodeRuntime): IRNodeRuntime {
  const existing = runtime.errors;
  if (existing === undefined) return runtime;

  return {
    ...runtime,
    errors: {
      declared: existing.declared,
      runtimeDerived: deriveRuntimeErrorContracts(runtime),
      global: existing.global,
    },
  };
}
