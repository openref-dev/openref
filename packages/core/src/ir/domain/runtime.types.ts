import type { IRConfidence, IRFact } from './confidence.types';
import type { IRSchemaSlot } from './schema.types';

/**
 * Runtime contract, per SPEC 6.3.
 *
 * These are the facts the running NestJS application knows and the specification file does
 * not. Populated in M1; declared from M0 so the IR shape never has to change to admit them.
 */

/** Where a node is implemented, and where to find it in the repository. */
export interface IRSourceLocation {
  readonly controller: string;
  readonly handler: string;
  readonly file?: string;
  readonly line?: number;
}

/** A guard observed on a route. Only the class name is knowable, never the logic. */
export interface IRGuard {
  readonly name: string;
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
}

/** Drift rules, per SPEC 7.1. */
export type IRDriftRule =
  | 'security-drift'
  | 'scope-drift'
  | 'ratelimit-undocumented'
  | 'stream-unspecified'
  | 'error-undocumented'
  | 'orphan-operation'
  | 'missing-description'
  | 'missing-example'
  | 'missing-operation-id'
  | 'dto-field-undescribed';

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
}

/** Runtime facts attached to one node. */
export interface IRNodeRuntime {
  readonly source?: IRSourceLocation;
  readonly guards?: readonly IRGuard[];
  readonly scopes?: IRFact<readonly string[]>;
  readonly roles?: IRFact<readonly string[]>;
  readonly rateLimit?: IRFact<IRRateLimit>;
  readonly errors?: IRErrorContracts;
  readonly streaming?: IRFact<IRStreaming>;
  readonly drift?: readonly IRDriftIssue[];
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
}
