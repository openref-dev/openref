/**
 * The error codes, in a module of their own.
 *
 * WHAT THE FIRST PAINT COSTS, AND THE TWO HYPOTHESES THAT WERE WRONG BEFORE THE ONE THAT WAS NOT.
 * `ErrorCode` stopped being an `enum` on 2026-09-02 so that `switch (error.code)` narrows for a
 * consumer. A bundler constant folds `Enum.MEMBER` and cannot constant fold a property read on a
 * real object, so the naive conversion put all thirty members into the chunk the first paint
 * downloads: measured by building the tree both ways, 111,921 raw against 110,559, which is 1,362
 * bytes on a budget with 33 to spare.
 *
 * THE FIRST FIX MEASURED FALSE AND IS RECORDED RATHER THAN QUIETLY REPLACED. Splitting the codes
 * into this file was meant to let the bundler put them in a chunk only the deferred try-it console
 * downloads. It moved nothing: `@openref/core` ships as ONE bundled file, so its error classes and
 * its codes reach the browser as one input and cannot be assigned to two chunks whatever the
 * source layout says. The second attempt, a per package module of named code constants, moved it
 * the wrong way: one module is one binding set, so all four of `@openref/vue`'s codes landed in
 * the first paint chunk to serve two the first paint never raises, at 49 bytes.
 *
 * WHAT ACTUALLY WORKED IS THE THING THE UNION MADE POSSIBLE. Browser reachable code in
 * `@openref/vue`, `@openref/render` and `@openref/runner` passes the code as a literal, which the
 * `ErrorCode` parameter type checks exactly as it checked `ErrorCode.THEME_SLOT_NOT_FOUND`: a
 * misspelling does not compile and a code removed from the union does not compile. That is what
 * the enum's constant folding was buying, bought a different way. Measured after: 110,559,
 * BYTE IDENTICAL TO THE FIGURE BEFORE THE CHANGE. THE CAP DID NOT MOVE.
 *
 * THIS FILE STAYS SPLIT ANYWAY, on its own merits rather than the one that failed: thirty codes
 * and twenty five classes are two subjects. `index.ts` imports the type and `../../index.ts`
 * re-exports the value, so every call site and the whole published surface are unchanged.
 */

/**
 * Stable machine readable error codes.
 *
 * A code is part of the observable surface of the CLI and of `doctor` output, so a code is
 * renamed only with a major version.
 *
 * AN OBJECT AND A UNION SINCE 2026-09-02, AND IT WAS AN `enum`. The enum shipped as
 * `declare enum ErrorCode` and was therefore nominal: a consumer writing
 * `switch (error.code) { case 'NORM_REF_UNRESOLVED': }` got no narrowing and, worse, got told the
 * two types have no overlap. What a consumer could write instead was a `switch` over
 * `ErrorCode.NORM_REF_UNRESOLVED` with a `default` branch, because the compiler could not tell
 * them the branches were complete either. A published enum that defeats exhaustiveness teaches
 * its consumer to write a `default`, and a `default` is where a code added in a minor version
 * goes to be silently handled as something else.
 *
 * Everything else in this surface is a literal union, so this is the shape that was already the
 * house rule. The call sites do not move: `ErrorCode.NORM_REF_UNRESOLVED` still reads and still
 * type checks, and the string `'NORM_REF_UNRESOLVED'` now does too, which is what makes a `switch`
 * exhaustive rather than nominal.
 */
export const ErrorCode = {
  /** A `$ref` could not be resolved to a target. */
  NORM_REF_UNRESOLVED: 'NORM_REF_UNRESOLVED',
  /** A `$ref` is not a well formed pointer, so there is no target to look for. */
  NORM_REF_MALFORMED: 'NORM_REF_MALFORMED',
  /** A cyclic schema exceeded the configured cycle depth. */
  NORM_CYCLE_DEPTH_EXCEEDED: 'NORM_CYCLE_DEPTH_EXCEEDED',
  /** The document declares a schema dialect the common pipeline cannot process. */
  NORM_UNSUPPORTED_DIALECT: 'NORM_UNSUPPORTED_DIALECT',
  /** A value reached canonical serialization that has no deterministic representation. */
  NORM_VALUE_NOT_SERIALIZABLE: 'NORM_VALUE_NOT_SERIALIZABLE',
  /** Two `allOf` branches describe a schema nothing can satisfy. */
  NORM_COMPOSITION_CONFLICT: 'NORM_COMPOSITION_CONFLICT',
  /** The document itself is malformed beyond repair. */
  NORM_DOCUMENT_INVALID: 'NORM_DOCUMENT_INVALID',
  /** The document is larger than intake will read, per SPEC 5.4. */
  NORM_DOCUMENT_TOO_LARGE: 'NORM_DOCUMENT_TOO_LARGE',
  /** Two different `$ref` targets are filed under one schema id, so one would be lost. */
  NORM_SCHEMA_ID_COLLISION: 'NORM_SCHEMA_ID_COLLISION',
  /**
   * A value nests deeper than the declared limit, in normalization or in canonical
   * serialization. Declared rather than inherited from the call stack, per SPEC 5.3.
   */
  NORM_DEPTH_EXCEEDED: 'NORM_DEPTH_EXCEEDED',

  /** A collector failed while gathering runtime facts. */
  COLLECT_FAILED: 'COLLECT_FAILED',
  /** An optional package a collector depends on is not installed. */
  COLLECT_NOT_AVAILABLE: 'COLLECT_NOT_AVAILABLE',
  /** A collector was configured without the metadata key it reads. */
  COLLECT_METADATA_KEY_MISSING: 'COLLECT_METADATA_KEY_MISSING',

  /** A request could not be serialized from the given parameter values. */
  RUN_SERIALIZATION_FAILED: 'RUN_SERIALIZATION_FAILED',
  /** Authentication could not be applied to the request. */
  RUN_AUTH_FAILED: 'RUN_AUTH_FAILED',
  /** The proxy refused the target host. */
  RUN_PROXY_HOST_BLOCKED: 'RUN_PROXY_HOST_BLOCKED',
  /** A stream ended abnormally. */
  RUN_STREAM_FAILED: 'RUN_STREAM_FAILED',
  /** The runner or the socket client was called in a build that does not carry one yet. */
  RUN_NOT_AVAILABLE: 'RUN_NOT_AVAILABLE',
  /** The server did not answer inside the configured limit, per SPEC 14.1. */
  RUN_TIMEOUT: 'RUN_TIMEOUT',
  /** The response body is larger than the console can hold or show, per SPEC 14.1. */
  RUN_RESPONSE_TOO_LARGE: 'RUN_RESPONSE_TOO_LARGE',

  /** A federated remote could not be reached. */
  FED_REMOTE_UNAVAILABLE: 'FED_REMOTE_UNAVAILABLE',
  /** Two remotes contributed conflicting definitions. */
  FED_MERGE_CONFLICT: 'FED_MERGE_CONFLICT',
  /**
   * A merge produced a document whose own references do not resolve.
   *
   * NOT A CONFLICT, WHICH IS WHY IT IS NOT ONE OF THOSE. A conflict is something the inputs did
   * and the modes of SPEC 15 answer; this is the merge engine having failed to carry a reference
   * across, which no configuration causes and no configuration fixes. It is separate so that a
   * caller catching `FED_MERGE_CONFLICT` to re-run under another mode cannot silently swallow it.
   */
  FED_MERGE_INCOMPLETE: 'FED_MERGE_INCOMPLETE',
  /**
   * A cached copy of a remote's document exists and cannot be used.
   *
   * NOT `FED_REMOTE_UNAVAILABLE`, because the remote's reachability is a separate fact: a cache
   * record can be corrupt while the remote is healthy, and reporting it as an unreachable remote
   * would send an operator to the wrong machine. The record crosses a process boundary under
   * SPEC 15's `degrade` mode, so a reader that cannot vouch for it refuses it by name rather
   * than serving whatever the bytes happen to decode to.
   */
  FED_CACHE_INVALID: 'FED_CACHE_INVALID',

  /** A theme does not satisfy the theme contract. */
  THEME_CONTRACT_VIOLATED: 'THEME_CONTRACT_VIOLATED',
  /** A theme referenced a slot that does not exist. */
  THEME_SLOT_NOT_FOUND: 'THEME_SLOT_NOT_FOUND',

  /** Options handed to a module or to the CLI are invalid. */
  CONFIG_INVALID_OPTIONS: 'CONFIG_INVALID_OPTIONS',

  /** `--from-nest` could not produce a document: the entry failed to load, boot, or mount one. */
  CLI_BOOT_FAILED: 'CLI_BOOT_FAILED',
  /** The command line was invalid: a missing argument, an unknown flag, an unknown command. */
  CLI_USAGE_INVALID: 'CLI_USAGE_INVALID',
  /** The loaded application did not close within the allotted time and was terminated. */
  CLI_SHUTDOWN_TIMEOUT: 'CLI_SHUTDOWN_TIMEOUT',
} as const;

/**
 * One of the codes above, as the union of their literal types.
 *
 * DECLARED FROM THE OBJECT AND NEVER RESTATED. A second hand written list of thirty names is a
 * second list that agrees until it does not, which is the defect two other lists in this
 * repository were built to remove. Adding a member to the object above adds it here, and a
 * `switch` over this union that was exhaustive stops compiling, which is the whole point.
 */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
