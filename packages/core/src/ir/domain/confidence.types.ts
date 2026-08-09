/**
 * Provenance of a runtime fact, per SPEC 6.1.
 *
 * | Level      | Source                                        |
 * | ---------- | --------------------------------------------- |
 * | `declared` | An explicit decorator                         |
 * | `derived`  | Metadata read under an explicitly known key    |
 * | `inferred` | Compile time AST plugin, best effort           |
 *
 * There is no fourth level. A fact that cannot be obtained produces a `doctor` warning,
 * never a guess.
 */
export type IRConfidence = 'declared' | 'derived' | 'inferred';

/**
 * A runtime fact together with where it came from.
 *
 * Every runtime value in the IR is wrapped in this shape. A bare value with no provenance
 * is not representable.
 */
export interface IRFact<T> {
  readonly value: T;
  readonly confidence: IRConfidence;
  /** Name of the collector that produced the value. */
  readonly collector: string;
}
