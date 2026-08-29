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
  readonly message: string;
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
  readonly timeout?: IRFact<IRTimeout>;
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
 * named the way a reader of `doctor` would recognise it, and the reason is one sentence that says
 * both what happened and what to write instead.
 */
export interface IRDiscoveryProblem {
  /** What was skipped: a handler, a gateway, a broker, a channel address. */
  readonly subject: string;
  /** Why, in a sentence. */
  readonly reason: string;
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
