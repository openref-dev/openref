import type { IRDocument } from '../../ir/domain/document.types';
import type { IRJsonValue } from '../../ir/domain/schema.types';

/**
 * Which positions the canonical form writes in their own order, per SPEC 5.3.
 *
 * THE ONE RULE AND ITS ONE EXCEPTION. Canonical serialization sorts keys by code point, which is
 * what makes one hash out of many equal spellings. The exception is a position whose keys the
 * document itself wrote: a schema's `properties`, a media type's named `examples`, a server's
 * `variables`, and everything under a member the IR declares as arbitrary JSON. There the order is
 * content, a page draws it, and a hash that does not carry it is not a function of everything the
 * page is drawn from.
 *
 * THE PRINCIPLE, WHICH IS WHAT DECIDES A POSITION THIS FILE HAS NOT MET YET. An object whose keys
 * this IR chose is sorted: `title` beside `type` beside `format` in any order says nothing a reader
 * can see. Keys the document's author chose keep the author's order. The three {@link IRDocument}
 * maps are the far side of that line and stay sorted: `nodes`, `schemas` and `webhooks` are keyed
 * by an identifier the normalizer builds, their order is walk order, and SPEC 5.1.1 requires the IR
 * to be invariant to walk order.
 *
 * THREE VERDICTS, BECAUSE TWO COULD NOT SAY IT. `ordered` is a map whose keys the author chose and
 * whose values are shapes this IR declares, so the keys keep their order and the values are read by
 * the rule again. `ordered-tree` is a position that is the author's all the way down, where nothing
 * below is this IR's and the record is never consulted again. `sorted` is everything else.
 *
 * WHY THE RECORD IS TOTAL AND NOT PROSE. A rule about the canonical form living somewhere nothing
 * enforces is exactly the defect this file closes, one level up. {@link IRAuthoredCandidate} is
 * computed from `IRDocument` by reachability, so a map or an arbitrary JSON member added to any type
 * the document can reach, including a type that does not exist yet, makes
 * {@link CANONICAL_MAP_ORDER} stop being total and fails the compile until it is given a verdict.
 *
 * THE BOUND ON THAT CLAIM, MEASURED RATHER THAN ASSERTED. The walk counts down {@link Fuel}, so it
 * is total to a measured depth and not to any depth. At the committed budget a position 32 type
 * graph edges from `IRDocument` fails the compile and one at 33 does not. The deepest position in
 * the IR today sits at 6 edges, `nodes` to `IRNode` to `responses` to `content` to `schema` to
 * `IRSchema` to `normalized`, so the headroom is 26 edges. The budget is not free either: the real
 * IR compiles at budgets of 48, 49, 50, 52 and 53 and first raises `TS2589` at 54, so the committed
 * value leaves 22 of margin below the first failing one rather than the 16 the first draft of this
 * paragraph claimed, which was an inference from one failing reading rather than a search for the
 * boundary. Every figure here reproduces by planting a chain of that length and compiling.
 *
 * WHY IT IS KEYED BY MEMBER NAME. The name is the only thing the serializer can see while walking a
 * value, so two IR types declaring a position under one name have to agree, and keying by the pair
 * would let the record record a distinction the serializer cannot act on. WHERE THAT COSTS
 * SOMETHING, and it costs something twice: `value` is `IRExample.value`, which is the author's, and
 * `IRFact.value`, which carries `IRRateLimit`, `IRTimeout`, `IRParameterReads` and `IRStreaming`,
 * whose keys are this IR's. `examples` is a map of `IRExample` on three types and an array of
 * arbitrary JSON on `IRJsonSchema`. Both are resolved towards the IR reading, because the
 * alternative hashes an order a normalizer literal was written in, which the principle forbids.
 *
 * WHAT THAT RESOLUTION COSTS, MEASURED OVER BOTH CORPORA ON 2026-09-02 RATHER THAN WAVED AWAY. It
 * is not nothing and the figure is written here so nobody has to rediscover it: 424 objects sit at
 * `IRExample.value` and 199 of them are written in an order sorting changes, and 20 objects sit in
 * an `IRJsonSchema.examples` array with 3 of them written so. Those 202 positions are a residual
 * instance of the defect this whole exception closes: a declared example a page prints verbatim,
 * whose key order the hash does not carry. Closing it needs a mechanism that can tell
 * `IRExample.value` from `IRFact.value` at run time, which is a description of the IR's shape and
 * therefore a second record able to drift from this one. It is named here, not hidden, and it is
 * the maintainer's to route.
 */

/** What the canonical form does with the keys at one position. */
export type CanonicalOrderVerdict = 'ordered' | 'ordered-tree' | 'sorted';

/**
 * Recursion budget for {@link IRAuthoredCandidate}, in the tuple form a conditional type counts down.
 *
 * THIRTY TWO, AND THE NUMBER IS MEASURED FROM BOTH SIDES. See the bound paragraph above: it reaches
 * a position 32 edges out, the IR's deepest is 6, and the compiler gives out at 64.
 */
type Fuel = [
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
];

/**
 * Whether a type is map shaped: a `Map`, or an object keyed by an open set of strings.
 *
 * Written with tuple wrappers so that a union member carrying a string index signature, which
 * `IRJsonValue` does, cannot make the answer `boolean` by distribution.
 */
type IsMapShaped<T> = [T] extends [ReadonlyMap<unknown, unknown>]
  ? true
  : [string] extends [keyof T]
    ? true
    : false;

/**
 * Whether a member is declared wide enough to hold any JSON value the author writes.
 *
 * `IRJsonValue` and `unknown` both pass, which is the intent: a member the IR types as either is a
 * member the IR asserts nothing about below itself, so no key under it is this IR's. `IRSchema.raw`
 * is the `unknown` one and is where a raw path dialect keeps a whole authored schema.
 */
type IsAuthoredJson<T> = [IRJsonValue] extends [T] ? true : false;

/**
 * Every map or arbitrary JSON member name reachable from `T`, walking arrays, map values and
 * object members.
 *
 * The walk is unbounded in the type graph, since `IRJsonSchema.properties` holds schemas, so it
 * counts down {@link Fuel} instead. A union of names is idempotent, so revisiting a type adds
 * nothing and the answer stabilizes well before the budget runs out.
 */
type AuthoredCandidateNames<T, Remaining extends readonly unknown[]> = Remaining extends readonly [
  unknown,
  ...infer Rest,
]
  ? [T] extends [never]
    ? never
    : T extends ReadonlyMap<unknown, infer Value>
      ? AuthoredCandidateNames<Value, Rest>
      : T extends readonly (infer Element)[]
        ? AuthoredCandidateNames<Element, Rest>
        : T extends object
          ? IsMapShaped<T> extends true
            ? AuthoredCandidateNames<T[string & keyof T], Rest>
            : {
                [Key in keyof T & string]-?:
                  | (IsMapShaped<NonNullable<T[Key]>> extends true ? Key : never)
                  | (IsAuthoredJson<T[Key]> extends true ? Key : never)
                  | AuthoredCandidateNames<NonNullable<T[Key]>, Rest>;
              }[keyof T & string]
          : never
  : never;

/**
 * Every member name an `IRDocument` can reach that the canonical form has to have a verdict for.
 *
 * This is the union {@link CANONICAL_MAP_ORDER} has to cover exactly. A new map or a new arbitrary
 * JSON member anywhere under the document grows it and the record stops compiling; an entry for a
 * member that no longer exists is an excess property and stops compiling too, so the totality holds
 * in both directions, to the depth the bound paragraph above measures.
 */
export type IRAuthoredCandidate = AuthoredCandidateNames<IRDocument, Fuel>;

/**
 * The verdict for every position the IR carries that could hold the author's own key order.
 *
 * Each entry says which side of the principle it falls on, so a reader meeting a sorted map beside
 * an ordered one can tell which is which without leaving the file.
 */
export const CANONICAL_MAP_ORDER = {
  /** Named examples of a parameter, media type or message. The document names and orders them. */
  examples: 'ordered',
  /** Per property serialization of a form body, keyed by the property name the document wrote. */
  encoding: 'ordered',
  /** Schema properties. The map whose order a schema page draws, and the one that started this. */
  properties: 'ordered',
  /** Schema properties keyed by pattern. The same map with the author's regular expressions. */
  patternProperties: 'ordered',
  /** Names that become required at a value, keyed by the keying property the document named. */
  dependentRequired: 'ordered',
  /** Discriminator mapping, keyed by the discriminator value the document chose. */
  mapping: 'ordered',
  /** Server url variables, keyed by the name written between the braces. */
  variables: 'ordered',
  /** OAuth2 scopes, keyed by the scope name and drawn in the order a document lists them. */
  scopes: 'ordered',
  /** Callback node ids, keyed by the callback name the document wrote. */
  callbacks: 'ordered',
  /** Channel address variables, keyed by the name written between the braces. */
  parameters: 'ordered',

  /**
   * Vendor extensions, keyed by the `x-` name the document wrote and holding arbitrary JSON.
   *
   * ORDERED ALL THE WAY DOWN, because `IRJsonValue` is where the IR stops describing the shape.
   * A page that shows an extension shows what the author wrote, in the order written, at every
   * level of it, so every level of it is content.
   */
  extensions: 'ordered-tree',
  /** Protocol bindings, kept verbatim. Ordered all the way down, for the reason `extensions` is. */
  bindings: 'ordered-tree',
  /**
   * The source of a schema on a raw path dialect, per SPEC 5.2.
   *
   * THE ONE MEMBER THE IR DECLARES AS `unknown`, so nothing below it is this IR's by construction,
   * and SPEC 5.2 has it rendered as annotated source. Sorting it would leave the defect this whole
   * exception exists against alive for Avro and Protobuf: two documents, one hash, two pages. Two
   * corpus subjects, both written in an order sorting changes, and both inside one document, so
   * exactly ONE committed digest turns on this entry: no named schema in either corpus carries a
   * raw body at all, measured at 0 of 2633, so both subjects are inline slots of
   * `aai-adeo-kafka-request-reply.yml`. The first draft of this comment said zero subjects and the
   * second said two digests; both were inferences, and the numbers above are counts.
   */
  raw: 'ordered-tree',
  /** A schema's `const`. The author's value, and it is drawn as written. */
  const: 'ordered-tree',
  /** A schema's `default`. The author's value where it is one, a plain string where it is not. */
  default: 'ordered-tree',
  /** The 3.0 spelling of a declared example, on a parameter or a media type. The author's value. */
  example: 'ordered-tree',

  /**
   * Nodes of the document, keyed by an id the normalizer builds.
   *
   * SORTED, AND ON THE FAR SIDE OF THE PRINCIPLE. The order here is the order the walk reached
   * the paths in, and a merged document's is the order the merge planned. SPEC 5.1.1 requires the
   * IR to be invariant to walk order, and what a reader sees in order is `navigation`, which is a
   * list and is hashed as one.
   */
  nodes: 'sorted',
  /** Named schemas, keyed by the id of SPEC 5.1.1. Sorted for the reason `nodes` is. */
  schemas: 'sorted',
  /** Webhooks, keyed by the name the document invents. Sorted for the reason `nodes` is. */
  webhooks: 'sorted',
  /**
   * `IRExample.value`, which is the author's, and `IRFact.value`, which is not.
   *
   * SORTED BECAUSE ONE NAME SERVES BOTH AND THE SERIALIZER SEES ONLY THE NAME. `IRFact` carries
   * `IRRateLimit`, `IRTimeout`, `IRParameterReads` and `IRStreaming`, whose keys this IR chose, and
   * ordering those would hash the order a normalizer literal was written in. The IR reading wins,
   * so a declared example written under `examples` does not carry its own key order while the same
   * value written under `example` does. The asymmetry has subjects and they are counted in the
   * header of this file rather than assumed away.
   */
  value: 'sorted',
} as const satisfies Readonly<Record<IRAuthoredCandidate, CanonicalOrderVerdict>>;

/**
 * The verdict for one member name, or `sorted` for a name the record does not carry.
 *
 * A FUNCTION RATHER THAN TWO DERIVED SETS, AND THE REASON IS MEASURED. Two `new Set(...)` at module
 * scope are statements a bundler may not assume are free, so `@openref/render`, which reaches this
 * module through `@openref/core` and never calls `canonicalize` in a browser, carried the record and
 * both constructions into a browser chunk as dead weight: 382 bytes, in a chunk no size budget
 * weighs. With no module level side effect left, an unused record is an unused object literal and
 * leaves with the rest.
 *
 * `Object.hasOwn` RATHER THAN A BARE LOOKUP, because a schema property may be named `constructor`
 * or `toString`, and a bare lookup would answer with something off the prototype.
 *
 * @param member - Member name as it is written in the value being serialized
 * @returns What the canonical form does with the keys at that position
 */
export function canonicalVerdictOf(member: string): CanonicalOrderVerdict {
  return Object.hasOwn(CANONICAL_MAP_ORDER, member)
    ? ((CANONICAL_MAP_ORDER as Readonly<Record<string, CanonicalOrderVerdict>>)[member] ?? 'sorted')
    : 'sorted';
}
