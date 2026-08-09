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
 * The UI shows the groups separately. One mixed list would be less honest: a global filter
 * does not mean this endpoint throws that error.
 */
export type IRErrorContractOrigin = 'declared' | 'runtime-derived' | 'global';

/** One error an operation can answer with, in RFC 9457 terms. */
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

/** One disagreement between the specification and the running application. */
export interface IRDriftIssue {
  readonly rule: IRDriftRule;
  readonly severity: IRDriftSeverity;
  /** Node the issue was found on; absent for document wide issues. */
  readonly nodeId?: string;
  readonly message: string;
  /** What the runtime says, rendered for display. */
  readonly runtimeValue?: string;
  /** What the specification says, rendered for display. */
  readonly specValue?: string;
  /** Concrete next action, for example adding a decorator. */
  readonly suggestion?: string;
}

/** Runtime facts attached to one node. */
export interface IRNodeRuntime {
  readonly source?: IRSourceLocation;
  readonly guards?: readonly IRGuard[];
  readonly scopes?: IRFact<readonly string[]>;
  readonly roles?: IRFact<readonly string[]>;
  readonly rateLimit?: IRFact<IRRateLimit>;
  readonly errors?: readonly IRErrorContract[];
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
