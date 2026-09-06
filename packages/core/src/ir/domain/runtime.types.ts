import type { IRConfidence, IRFact } from './confidence.types';
import type { IRSchemaSlot } from './schema.types';

/**
 * Where a parameter is carried.
 *
 * DEFINED HERE AND USED BY `node.types` RATHER THAN THE OTHER WAY AROUND, since
 * `TX-COLLECTORS`: `IRParameterRead` below needs it too, `node.types` already imports this file
 * for `IRNodeRuntime`, and the dependency cruiser rightly refuses the cycle the opposite
 * direction would close.
 */
export type IRParameterLocation = 'path' | 'query' | 'header' | 'cookie';

/**
 * Runtime contract, per SPEC 6.3.
 *
 * These are the facts the running NestJS application knows and the specification file does
 * not. Populated in M1; declared from M0 so the IR shape never has to change to admit them.
 */

/**
 * Where a node is implemented, and where to find it in the repository.
 *
 * TWO PATHS BECAUSE THEY ARE TWO DIFFERENT FACTS, per SPEC 6.3 and `T018-R1`. `file` is a path a
 * forge can resolve, relative to a repository root and true for every reader; `absolutePath` is a
 * path only the machine that built the document can resolve, and it is what an editor's URL
 * scheme needs. The second is absent unless the host asked for it, because a served document
 * carrying one publishes that machine's directory layout to everyone who opens the page.
 */
export interface IRSourceLocation {
  readonly controller: string;
  readonly handler: string;
  /** Repository relative, forward slashes, no leading slash. Absent when there is no repository. */
  readonly file?: string;
  readonly line?: number;
  /**
   * Absolute path on the machine the document was built on, as the locator returned it.
   *
   * PRESENT ONLY BEHIND AN OPT IN, which is `sourceCollector({ absolutePath: true })` and nothing
   * else. SPEC 6.3 says what it costs the host who sets it.
   */
  readonly absolutePath?: string;
  /**
   * One based column, from the source map rather than defaulted.
   *
   * IT RIDES WITH {@link absolutePath} AND ONLY WITH IT, per SPEC 6.3: no forge takes a column,
   * so on its own it says nothing to anybody and spends a document's bytes saying it.
   */
  readonly column?: number;
}

/**
 * How widely a guard was registered, per SPEC 6.2.1.
 *
 * TWO VALUES BECAUSE A READER ASKS TWO QUESTIONS AND THE SECOND ONE DEPENDS ON THIS. "Is this
 * endpoint protected" is answered the same way by both, and "what did somebody decide about this
 * endpoint" is not: `@UseGuards` on a controller or a handler is a decision about that route,
 * and `{ provide: APP_GUARD }` is a decision about the application that this route inherits.
 * Controller and handler are not told apart, because both are the route's own declaration and
 * NestJS applies them together.
 */
export type IRGuardScope = 'route' | 'global';

/** A guard observed on a route. Only the class name is knowable, never the logic. */
export interface IRGuard {
  readonly name: string;
  /** Whether it was declared on this route or registered for the whole application. */
  readonly scope: IRGuardScope;
  readonly confidence: IRConfidence;
  readonly collector: string;
}

/** Rate limit as declared by a throttler. */
export interface IRRateLimit {
  readonly limit: number;
  readonly ttlMs: number;
  readonly name?: string;
}

/**
 * How far rate limiting reaches a route that declares none of its own, per SPEC 6.2.3.
 *
 * THREE STATES, AND ONLY ONE OF THEM HAD A REPRESENTATION. A reader of one operation has to be
 * able to tell apart: this route declares its own limit, which is {@link IRRateLimit} on
 * `rateLimit` and always could be said; a limit governs it from outside its own declaration, which
 * is `external` here; and nothing anywhere rate limits it, which is `none`. Until this type the
 * second and third were one absent field, so a page told a route covered by a globally registered
 * limiter the same thing it told an unlimited route, and pointed both at a different report on a
 * different page to find out which. That is the defect measured on an application where four of
 * fifty eight routes carry a decorator and a guard registered under `APP_GUARD` stands in front of
 * all fifty eight.
 *
 * IT IS NOT A LIMIT AND MUST NEVER BE READ AS ONE. `external` says what stands in front and what
 * budget was configured for it; it does not say that the budget applies to this route, because
 * whether it does is decided inside guard code, and guard logic is never read, per SPEC 6.1. The
 * two are kept in separate members for that reason: anything that wants "the limit this route
 * enforces" reads `rateLimit`, and no reading of this member can be mistaken for one.
 *
 * IT IS GENERAL AND NOT ONE LIBRARY'S. `@nestjs/throttler` behind an `APP_GUARD` and
 * `@nestjs-redisx/rate-limit` behind one are the same three states, and so is any collector that
 * can see a limiter it cannot attribute to a route. The collector fills in the names and the
 * budget it managed to read; the words a reader sees are built once, from this shape.
 */
export type IRRateLimitReach =
  | {
      /** Something limits from outside the route, and this route declares nothing of its own. */
      readonly kind: 'external';
      /**
       * What stands in front, by class name, exactly as it was registered.
       *
       * EVERY GLOBAL REGISTRATION AND NOT THE ONES THAT LIMIT, because which of them limits is the
       * thing that cannot be read. A collector that filtered this list by guessing which class name
       * sounds like a rate limiter would be making the inference SPEC 6.1 forbids, so the list is
       * what was registered and the sentence beside it refuses to say what each one does.
       */
      readonly by: readonly string[];
      /**
       * The budget whatever governs it was configured with, where a configuration states one.
       *
       * ABSENT IS A REAL ANSWER: nothing anywhere states a number, which is different from a number
       * that exists and is not this route's. Present is not an attribution either, per the note
       * above; it is the figure a reader would otherwise have to go and find.
       */
      readonly budget?: IRRateLimit;
      /** Where the budget was read, named so a reader can look at the same place. */
      readonly budgetSource?: string;
    }
  | {
      /**
       * Nothing rate limits this route: it declares none and nothing stands in front of it.
       *
       * A STATEMENT AND NOT A SILENCE, which is the whole reason this member exists. It is the
       * answer `hasRuntimeFacts` counts, so a route carrying only this still draws its scale: a
       * reader who registered a rate limit collector asked a question, and "nothing" is the reply.
       */
      readonly kind: 'none';
    };

/**
 * How widely a pipe was registered, per SPEC 6.2.1 and `TX-COLLECTORS`.
 *
 * THREE VALUES WHERE A GUARD HAS TWO, because a pipe can stand somewhere a guard cannot: on one
 * parameter. The reader's question is the same as for guards, "what was decided about this
 * input", and `@UsePipes` on the class or the handler is the route's own declaration, a provider
 * under `APP_PIPE` is a decision about the application, and a pipe inside `@Query('sort', ...)`
 * is a decision about one value. Controller and handler are not told apart, for the reason
 * `IRGuardScope` does not tell them apart: both are the route's declaration and NestJS applies
 * both.
 */
export type IRPipeScope = 'global' | 'route' | 'parameter';

/** A pipe observed on a route. Only the class name is knowable, never the logic. */
export interface IRPipe {
  readonly name: string;
  /** Whether it stands on this route, on the whole application, or on one parameter. */
  readonly scope: IRPipeScope;
  readonly confidence: IRConfidence;
  readonly collector: string;
}

/**
 * A timeout the application enforces on a route.
 *
 * THE VALUE COMES FROM METADATA UNDER A HOST NAMED KEY AND FROM NOTHING ELSE, per SPEC 6.2.1.
 * An interceptor's class name is not a number, and its logic is never read on the same grounds
 * a guard's is never read. Milliseconds, for the reason `IRRateLimit.ttlMs` is milliseconds.
 */
export interface IRTimeout {
  readonly ms: number;
}

/**
 * Which behaviour a handler declared around itself, per SPEC 6.2.
 *
 * THREE KINDS BECAUSE THREE LIBRARIES WRITE THEM AND A READER ASKS THREE QUESTIONS. Is this
 * response served from a cache and for how long; is this route serialized under a lock; is this
 * route behind a breaker and what trips it. They are one member of {@link IRNodeRuntime} rather
 * than three because they are one shape, a list whose members each carry their own provenance, and
 * because three members would be three fact fields, three collector tables and three rows for a
 * distinction the shape itself already draws.
 */
export type IRHandlerPolicyKind = 'cache' | 'lock' | 'circuit-breaker';

/**
 * How far a declared policy reaches the response a caller receives, per SPEC 6.1.
 *
 * THE DECLARATION IS THE FACT AND ITS REACH IS A SECOND FACT, and until both are said the first one
 * is a half truth a reader cannot act on. `@nestjs-redisx/cache` ships two families of decorator
 * under one name: `@Cached` replaces the method with a wrapper the moment it is applied, so the
 * behaviour is bound by the decorator itself; `@Cacheable`, `@CachePut` and `@CacheEvict` are bare
 * `SetMetadata` calls read by an interceptor the library registers nowhere, so the same page would
 * otherwise show a ttl for a route that caches nothing at all.
 *
 * IT IS NOT A CONFIDENCE AND MUST NOT BE READ AS ONE. Both readings are `derived`: the value came
 * from metadata under a key this project knows, which is exactly what SPEC 6.1 means by the level.
 * What differs is not how well the fact was read but what the fact is about, and folding the two
 * into one scale would say the unbound declaration was read less well rather than that it binds
 * nothing.
 */
export type IRHandlerPolicyReach =
  /** The decorator wrapped the handler, so every call to the route goes through the behaviour. */
  | 'handler'
  /** The decorator recorded an intention and nothing observed here binds it to a served response. */
  | 'unbound';

/**
 * One setting of a policy, in the value the decorator stored.
 *
 * A NAME AND A VALUE RATHER THAN A SCHEMA PER LIBRARY, and the choice is the one
 * `IRRateLimitReach` makes for its own contents: what only a collector can supply is which knobs
 * the application set and to what, and the words a reader sees are built once from this shape.
 * Three declared schemas would be three copies of somebody else's option object, each of which
 * this project would then have to keep in step with a library it does not own.
 *
 * THE NAME CARRIES THE UNIT AND IS NOT ALWAYS THE DECORATOR'S OWN. `@Cached({ ttl })` is seconds
 * and `@WithLock({ ttl })` is milliseconds, so a member called `ttl` on both would put two
 * quantities under one word on one page. Milliseconds throughout, for the reason
 * {@link IRRateLimit} is milliseconds, and a collector that converts says so where it converts.
 */
export interface IRHandlerPolicySetting {
  /** What was declared, named for a reader, with its unit where the value has one. */
  readonly name: string;
  /** The value as the decorator stored it, converted only where {@link name} says so. */
  readonly value: string | number | boolean | readonly string[];
}

/**
 * A behaviour a handler declares around itself that the specification carries no field for.
 *
 * A LIST WHOSE MEMBERS EACH CARRY PROVENANCE, LIKE `guards` AND `pipes` AND UNLIKE `rateLimit`.
 * Three collectors can report on one route at once, and a cache, a lock and a breaker on one
 * handler are three facts rather than one fact three collectors disagree about, so they accumulate
 * and no tie is possible. An `IRFact` here would have made the second collector on a route contest
 * the first and lose in silence.
 *
 * NOTHING HERE IS AN ERROR CONTRACT, AND THAT WAS MEASURED RATHER THAN PREFERRED. None of the three
 * libraries this exists to read contains an `ExceptionFilter`, an `HttpException` or an `HttpStatus`
 * anywhere in its source: a lock that cannot be acquired throws a plain `Error` subclass and a
 * breaker that is open throws another, and what status a caller sees is whatever the host's own
 * filter does with it. Putting a status in `IRErrorContracts.runtimeDerived` would have been the
 * cheaper home and would have been the guess CLAUDE.md rule 5 forbids.
 */
export interface IRHandlerPolicy {
  readonly kind: IRHandlerPolicyKind;
  /**
   * The key or key template the behaviour is scoped by, when it is a literal string.
   *
   * ABSENT WHERE THE KEY IS A FUNCTION, per SPEC 6.1: a function under a key is never read, so
   * what the cache varies by or what the lock serializes on cannot be stated. The collector that
   * met one records it for `doctor` rather than leaving the absence to be read as "no key".
   */
  readonly key?: string;
  /** What the decorator declared, in the order the collector reads its options. */
  readonly settings: readonly IRHandlerPolicySetting[];
  /** How far the declaration reaches the response a caller receives. */
  readonly reach: IRHandlerPolicyReach;
  readonly confidence: IRConfidence;
  readonly collector: string;
}

/**
 * What the handler scan concluded about one declared parameter, per SPEC 6.2.1.
 *
 * THE THREE VALUES ARE THE DISTINCTION THE SCAN IS REQUIRED TO CARRY. `read` when a decorator
 * binds the name, or a required header fact names it, since the guard reading a header is the
 * application reading it. `not-seen-read` ONLY when the scan accounted for every access path of
 * the parameter's location and the name is not among the reads: it is a statement about the
 * handler, and the rule SP010 fires on it. `unaccounted` when the scan could not account for a
 * path, a whole object binding used opaquely, or a cookie, which no NestJS binding reads: it is
 * a statement about the scan, and no rule ever fires on it.
 */
export type IRParameterReadVerdict = 'read' | 'not-seen-read' | 'unaccounted';

/** One declared parameter, with the scan's verdict about it. */
export interface IRParameterRead {
  readonly in: IRParameterLocation;
  readonly name: string;
  readonly verdict: IRParameterReadVerdict;
}

/**
 * The handler scan's verdicts, one per declared parameter, in the document's parameter order.
 *
 * THE WHOLE FACT IS ABSENT WHEN THE SCAN COULD NOT ACCOUNT FOR THE HANDLER AT ALL, `@Req`,
 * `@Res`, a custom parameter decorator, a request scoped controller, or a wrapper whose source
 * does not match the bindings. A blind instrument says nothing, per SPEC 6.1, and the reason
 * goes to `doctor` rather than into a fact full of `unaccounted`.
 */
export interface IRParameterReads {
  readonly parameters: readonly IRParameterRead[];
}

/**
 * Which of the three groups an error contract belongs to, per SPEC 6.4.
 *
 * The UI shows the groups separately. One mixed list would be less honest: a guard standing in
 * front of a route does not mean this endpoint promises the statuses that guard can produce.
 */
export type IRErrorContractOrigin = 'declared' | 'runtime-derived' | 'global';

/**
 * One error an operation can answer with, in RFC 9457 terms.
 *
 * `origin` IS KEPT EVEN THOUGH {@link IRErrorContracts} ALREADY SORTS BY IT, because a contract
 * travels alone as well as in a group: a drift finding carries one, and so does anything that
 * shows a single row. What the redundancy costs is the chance of the two disagreeing, and that is
 * closed by `groupErrorContracts` being the only thing that decides which group a contract lands
 * in, plus a test that every member of a group agrees with the group it is in.
 */
export interface IRErrorContract {
  readonly status: number;
  /** RFC 9457 `type` URI. */
  readonly type?: string;
  readonly title: string;
  readonly detail?: string;
  readonly origin: IRErrorContractOrigin;
  readonly confidence: IRConfidence;
  readonly collector: string;
  readonly schema?: IRSchemaSlot;
}

/**
 * The three groups of SPEC 6.4, kept as three fields rather than one tagged list.
 *
 * THIS SHAPE IS THE POINT OF T021 AND NOT AN ARRANGEMENT OF IT. A flat array with `origin` on
 * each member renders as one list in a single line of code, and the difference between what an
 * endpoint promises and what was observed about it then depends on every later reader choosing
 * to preserve it. The first helper that wants "just the errors" would concatenate them and break
 * nothing that compiles. Three fields cannot be rendered as one list without somebody deliberately
 * writing the concatenation, which is the point at which it becomes a decision rather than a
 * default.
 *
 * A GROUP IS PRESENT AND EMPTY, OR THE WHOLE FIELD IS ABSENT, and the two say different things.
 * `IRNodeRuntime.errors` missing means no error collector ran: there was nobody to ask. A present
 * `declared` group that is empty means the route was examined and nothing was declared on it. That
 * is the same distinction `IRRuntimeMeta.skipped` draws one level up.
 */
export interface IRErrorContracts {
  /** What a person declared with `@ApiErrors`. Promises. */
  readonly declared: readonly IRErrorContract[];
  /** What was derived from facts already collected about the route. Observations. */
  readonly runtimeDerived: readonly IRErrorContract[];
  /** What the host declared for the whole application. */
  readonly global: readonly IRErrorContract[];
}

/** Transport a streaming endpoint uses. */
export type IRStreamTransport = 'sse' | 'websocket' | 'chunked';

/** Streaming shape of an endpoint. `itemSchema` is only ever declared, never reflected. */
export interface IRStreaming {
  readonly transport: IRStreamTransport;
  readonly itemSchema?: IRSchemaSlot;
  readonly heartbeatMs?: number;
  /**
   * The value the server sends to say the stream is over, such as `[DONE]`.
   *
   * DECLARED AND NEVER GUESSED, like `itemSchema` beside it. A terminator is a convention between
   * one API and its clients, and a console that inferred one would end a stream early on an
   * element that happened to match. It arrives from `@ApiStream({ terminator })` and from nowhere
   * else. Added at T030: the decorator accepted the field from M1 and nothing carried it here,
   * which is the declared but never filled class of SPEC 0 in its other direction.
   */
  readonly terminator?: string;
}

/** Drift rules, per SPEC 7.1, in catalogue order. */
export type IRDriftRule =
  | 'security-drift'
  | 'scope-drift'
  | 'ratelimit-undocumented'
  | 'stream-unspecified'
  | 'error-undocumented'
  | 'orphan-operation'
  | 'parameter-unread'
  | 'header-requiredness-drift'
  | 'status-drift'
  | 'operation-key-unread'
  | 'missing-description'
  | 'missing-example'
  | 'missing-operation-id'
  | 'dto-field-undescribed'
  | 'discovery-incomplete';

/** How loudly a drift issue is reported, and what `--fail-on` compares against. */
export type IRDriftSeverity = 'error' | 'warning' | 'info';

/**
 * What writing the runtime fact into the source would require, observed per finding.
 *
 * THIS IS THE ONLY THING THE CLASSIFIER READS, WHICH IS WHY IT IS A PROPERTY OF THE NODE'S STATE
 * AND NOT OF THE RULE. A rule selects which check runs; what shape of edit its finding would need
 * depends on what the specification already says about the subject, and one rule reaches several
 * shapes in one run. `ratelimit-undocumented` needs a new response where the document is silent
 * about 429 and a second, conflicting one where it already states a different limit.
 */
export type IRDriftEdit =
  /** No runtime fact names the missing thing, so there is nothing to write. */
  | 'nothing-to-write'
  /** A new assertion, added where the specification is silent. Nothing existing is touched. */
  | 'new-assertion'
  /** A new assertion that would sit beside an existing one saying something different. */
  | 'conflicting-assertion'
  /** A change reaching inside an assertion that already exists. */
  | 'narrowed-assertion'
  /**
   * A fact about the whole application that does not say whether this subject is inside it.
   *
   * THE FACT IS REAL AND ITS REACH IS NOT OBSERVABLE, which is a third thing beside having a fact
   * and having none. A guard registered under `APP_GUARD` stands in front of every route, and
   * whether one route escapes it is decided by metadata that guard reads inside its own logic, per
   * SPEC 6.1 and CLAUDE.md's rule about guard logic. Writing the assertion would state a
   * requirement about a route nothing measured; withholding the finding would hide a guard the
   * reader can see running. So it is reported, and it is a person's to settle.
   */
  | 'unscoped-assertion'
  /** A deletion of an existing assertion, which is the only edit that would satisfy the rule. */
  | 'deleted-assertion'
  /** The source already asserts it; the gap is in the generated document, which is never written. */
  | 'already-asserted';

/**
 * The add-only assertion that would describe the observed fact, in values rather than in prose.
 *
 * IT EXISTS BECAUSE `suggestion` IS A SENTENCE AND A REWRITER MUST NOT READ SENTENCES. Every value
 * a mechanical edit needs was already computed by the rule that found the drift, and until this
 * type the only place it survived was inside the English of `suggestion`: the security scheme a
 * guard maps to appeared nowhere else at all, so a fix mode could either parse prose, which is the
 * guess SPEC 6.1 forbids, or refuse a rule SPEC 7.4 calls fixable. This carries the same values
 * the sentence names, so the two cannot disagree and neither has to be parsed.
 *
 * A FINDING CARRIES ONE ONLY WHEN THE RULE COULD NAME ONE, AND CARRYING ONE IS NOT A CLAIM THAT
 * ANYTHING SHOULD BE WRITTEN. Whether it may be is {@link IRDriftClassification}'s answer and
 * nothing else's: a contradiction can carry an assertion it must never apply, and a consumer that
 * reads this field without asking the classifier first has reimplemented the defect the classifier
 * exists to prevent.
 */
export type IRDriftAssertion =
  /** The operation is guarded and asserts no security; this is the scheme the guard maps to. */
  | { readonly kind: 'security-scheme'; readonly scheme: string }
  /** The runtime answers this status and no response documents it. */
  | { readonly kind: 'response-status'; readonly status: number; readonly description?: string }
  /** The document names no stable id for an operation whose handler is known. */
  | { readonly kind: 'operation-id'; readonly operationId: string }
  /**
   * There is a fact and no name for it, so no assertion can be spelled.
   *
   * A GUARD CLASS NAME IS NOT A SECURITY SCHEME, per SPEC 7.1, so a host that configured no
   * `runtime.guardSecuritySchemes` leaves `security-drift` with an observed fact and nothing to
   * write. Saying that here is what lets a fix mode report `unconfigured mapping` as the reason a
   * finding was left, rather than reporting the absence of a field as the absence of a finding.
   */
  | { readonly kind: 'unnameable'; readonly reason: 'unconfigured-mapping' };

/**
 * The runtime side of a finding: a fact somebody collected, or nothing at all.
 *
 * A UNION RATHER THAN AN OPTIONAL CONFIDENCE, so a finding that rests on no observation cannot be
 * mistaken for one whose confidence somebody forgot to fill in. `missing-description` has no
 * runtime fact behind it in any application, and saying so is different from saying nothing.
 *
 * THE COLLECTOR IS NOT REPEATED HERE. It is on the node's own fact, one hop from the finding
 * through `nodeId`, and `IRSourceLocation` carries none at all, so a `collector` field on the
 * basis would be a name this package had to invent for at least one rule.
 */
export type IRDriftBasis =
  | { readonly kind: 'collected'; readonly confidence: IRConfidence }
  | { readonly kind: 'unobserved' };

/**
 * Why a finding needs a person, per `ai-docs/REMEDIATION.md` section 2.
 *
 * Three different things put a finding here and they age differently: `confidence-starvation` can
 * become `silence` when a collector improves, and the other two cannot.
 */
export type IRDriftManualReason =
  'structural-ambiguity' | 'confidence-starvation' | 'no-observed-fact';

/**
 * Which remediation bucket a finding lands in, per SPEC 7.4.
 *
 * `manual` CANNOT BE SPELLED WITHOUT ITS REASON, which is why this is a union and not a bucket
 * beside an optional reason. A bucket that says "a person has to look at this" and does not say
 * what kind of looking is a row a reader cannot act on and a consumer cannot sort.
 */
export type IRDriftClassification =
  | { readonly bucket: 'silence' }
  | { readonly bucket: 'contradiction' }
  | { readonly bucket: 'manual'; readonly reason: IRDriftManualReason };

/** The three buckets by name, for a consumer that only wants the label. */
export type IRDriftBucket = IRDriftClassification['bucket'];

/** One disagreement between the specification and the running application. */
export interface IRDriftIssue {
  readonly rule: IRDriftRule;
  readonly severity: IRDriftSeverity;
  /** Node the issue was found on; absent when the subject is a schema or the whole document. */
  readonly nodeId?: string;
  /** Schema the issue was found on, when the subject is a schema rather than a node. */
  readonly schemaId?: string;
  /** JSON pointer into the subject, such as `/properties/total`, when it is narrower than one. */
  readonly pointer?: string;
  /**
   * What the issue is about when it is neither a node nor a schema, per SPEC 7.2.
   *
   * ADDED AT `T054` FOR `discovery-incomplete`, whose subjects are handlers, gateways, brokers and
   * channel addresses. SPEC 7.2 requires a finding to name its subject and the two members above
   * can name only the two kinds of thing a document holds, so a document level rule about anything
   * else printed `(document)` and lost the one word a reader needs to act. Set only by a rule that
   * has a subject of its own; a node or schema issue leaves it out and is named by its id as
   * before.
   */
  readonly subject?: string;
  /**
   * What is wrong, in one clause, without the subject in front of it and without the fix in it.
   *
   * BOTH HALVES OF THAT SENTENCE WERE BROKEN BY ONE RULE AND ARE NOW STATED, per SPEC 7.2.
   * `discovery-incomplete` built this as `${subject}: ${reason}` and then set `suggestion` to the
   * same `reason`, so every reader of the health page was shown one sentence twice, once with the
   * subject glued to the front of it. The subject travels in {@link subject}, the action travels in
   * `suggestion`, and neither is repeated here.
   */
  readonly message: string;
  /**
   * The longer reasoning behind the finding, for a reader who opens it, per SPEC 7.2.
   *
   * IT IS NOT A SECOND MESSAGE AND A RENDERER MAY LEAVE IT CLOSED. Everything a reader must have to
   * act is in {@link message} and `suggestion`; this is why the fact is unobtainable rather than
   * merely missing, which is the difference between a finding a reader can fix and one they should
   * stop trying to.
   */
  readonly detail?: string;
  /** What the runtime says, rendered for display. */
  readonly runtimeValue?: string;
  /** What the specification says, rendered for display. */
  readonly specValue?: string;
  /** Concrete next action, naming the decorator or the builder call, per SPEC 7.2. */
  readonly suggestion: string;
  /** Which bucket of SPEC 7.4 this finding is in, computed from the state of its subject. */
  readonly classification: IRDriftClassification;
  /** The observation the classification was computed from, so a consumer can check it. */
  readonly edit: IRDriftEdit;
  /** The runtime fact behind the finding, whose confidence gates any mechanical edit. */
  readonly basis: IRDriftBasis;
  /** The assertion that would describe the fact, in values, when the rule could name one. */
  readonly assertion?: IRDriftAssertion;
}

/** Runtime facts attached to one node. */
export interface IRNodeRuntime {
  readonly source?: IRSourceLocation;
  readonly guards?: readonly IRGuard[];
  readonly pipes?: readonly IRPipe[];
  readonly scopes?: IRFact<readonly string[]>;
  readonly roles?: IRFact<readonly string[]>;
  readonly rateLimit?: IRFact<IRRateLimit>;
  /**
   * What limits the route when the route declares nothing, per SPEC 6.2.3.
   *
   * A SECOND MEMBER RATHER THAN A WIDER `rateLimit`, for the reason {@link IRRateLimitReach} gives:
   * a reader of `rateLimit` is reading what this route enforces, and admitting a value that means
   * "something else might" into that member would put an unattributed budget in front of every
   * consumer that already reads it, including the drift rule that compares one against a documented
   * 429. Nothing here is ever compared with the specification.
   */
  readonly rateLimitReach?: IRFact<IRRateLimitReach>;
  readonly timeout?: IRFact<IRTimeout>;
  /**
   * Behaviours the handler declares around itself, per {@link IRHandlerPolicy}.
   *
   * A LIST AND NOT AN `IRFact`, for the reason `guards` is a list: three collectors can report on
   * one route at once and each of them is reporting a different behaviour, so they accumulate and
   * carry their own provenance rather than competing for one slot.
   */
  readonly handlerPolicies?: readonly IRHandlerPolicy[];
  readonly requiredHeaders?: IRFact<readonly string[]>;
  readonly parameterReads?: IRFact<IRParameterReads>;
  readonly statusCode?: IRFact<number>;
  readonly errors?: IRErrorContracts;
  readonly streaming?: IRFact<IRStreaming>;
  readonly drift?: readonly IRDriftIssue[];
}

/**
 * One thing the discovery of a running application found and could not state, per SPEC 8.3.
 *
 * IT IS NOT AN ERROR AND IT IS NOT A GUESS AVOIDED SILENTLY. A pattern no address can be made
 * from, a gateway that declares no event, a protocol whose host nobody configured, a class name no
 * supplied schema answers to: each is a fact the reference would have carried and cannot, and
 * CLAUDE.md's rule is that such a fact reaches `doctor` rather than being invented. The subject is
 * named the way a reader of `doctor` would recognise it.
 *
 * THE REASON IS THE SHORT CLAUSE AND THE REASONING IS BELOW IT, SINCE 2026-09-05 AND SPEC 7.1. It
 * was one sentence carrying both what happened and what to write instead, which on the first real
 * reader ran to fifty words of the product explaining itself with no action in it. What a reader
 * gets first now names the cause and what is therefore not known, in the voice of the `source` row
 * SPEC 7.1 sets as the standard, and {@link detail} carries everything that used to be crammed in
 * beside it.
 */
export interface IRDiscoveryProblem {
  /** What was skipped: a handler, a gateway, a broker, a channel address. */
  readonly subject: string;
  /**
   * The cause and what is not known because of it, in one clause, per SPEC 7.1.
   *
   * IT IS WHAT A READER SEES FIRST AND IT IS THE WHOLE OF WHAT SOME READERS SEE, so it is not an
   * abbreviation of {@link detail} that assumes the rest will be opened. The action goes here too
   * when there is one, and when there is none this says so plainly rather than leaving a reader to
   * work out that the record is only a record.
   */
  readonly reason: string;
  /**
   * What the reader is to do, or that there is nothing to do and why the finding exists anyway.
   *
   * SEPARATE FROM {@link reason} BECAUSE THEY LAND IN DIFFERENT PLACES. A browser theme draws the
   * reason and the action one under the other, and `openref doctor` draws the subject and the
   * action and never the reason, so one string in both slots is one sentence printed twice on one
   * surface and the wrong half printed on the other.
   *
   * OPTIONAL ONLY FOR THE PRODUCERS THAT HAVE NOT MOVED. A producer that leaves it out has its
   * reason used for both, which is what every producer did before SPEC 7.1 asked for the split; the
   * collectors of SPEC 6.2 all set it.
   */
  readonly action?: string;
  /**
   * Why the fact is unobtainable rather than merely absent, for a reader who asks.
   *
   * OPTIONAL BECAUSE SOME CAUSES ARE THEIR OWN EXPLANATION. A metadata key that holds the wrong
   * type needs no second paragraph; a scan that will not guess past a custom parameter decorator
   * does, and deleting that reasoning to make the first line short would trade one defect for
   * another. Nothing is required to read it, and a consumer that does not is showing a complete
   * finding rather than a truncated one.
   */
  readonly detail?: string;
}

/** Document wide runtime metadata: which collectors ran, and how to link to source. */
export interface IRRuntimeMeta {
  /** Names of the collectors that ran, in registration order. */
  readonly collectors: readonly string[];
  /** ISO 8601 instant the facts were collected. A string, so the IR stays serializable. */
  readonly collectedAt?: string;
  readonly nestVersion?: string;
  /** Template such as `https://host/org/repo/blob/{ref}/{file}#L{line}`. */
  readonly sourceLinkTemplate?: string;
  /** Collectors that were skipped, with the reason, for `doctor` to report. */
  readonly skipped?: readonly { readonly collector: string; readonly reason: string }[];
  /**
   * Guard class name to security scheme id, exactly as the host configured it, per SPEC 13.2.
   *
   * IT TRAVELS WITH THE DOCUMENT BECAUSE THE COMPARISON IT DECIDES IS RE-ASKED AFTER THE PASS ENDS.
   * `security-drift` is out of scope without it, per its own rule, so a renderer re-asking the rule
   * with no mapping answered `out-of-scope` for every guarded operation whose security the document
   * does state, and drew `?` on the parity scale over the same operations the health report had
   * already counted as passed. The gutter and the report then said different things about one
   * comparison, which is the class of defect this field closes: one input, one answer, wherever the
   * question is asked from.
   *
   * A `Record` and not a `Map`, unlike `DriftObservation.guardSchemes`, because this one is part of
   * a document that is serialized and hashed rather than part of a call.
   */
  readonly guardSchemes?: Readonly<Record<string, string>>;
  /**
   * What the discovery of the running application found and could not state, per SPEC 8.3.
   *
   * ONE LIST BECAUSE THE GAP WAS ONE GAP OVER TWO LISTS. `@openref/nest` builds problems on the
   * HTTP pass and on the event synthesis, and neither had a printer; both land here, before the
   * health report is built, so the `discovery-incomplete` rule of SPEC 7.1 reads one place. It is
   * optional because a document that no runtime pass produced has no discovery at all, which is
   * not the same as a discovery that found nothing.
   */
  readonly problems?: readonly IRDiscoveryProblem[];
}
