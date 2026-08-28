/**
 * Breaking and non breaking classification between two versions of one document, per SPEC 17.1.
 *
 * THE COMPARISON IS OVER IR, NEVER OVER RAW DOCUMENTS. Both sides went through the normalizer, so
 * formatting, key order and element order are already gone, which is the payoff T002 promised.
 * On top of that, everything set shaped is compared as a set here: `required`, `enum`, `oneOf`
 * and `anyOf` branches, and security requirement lists, so reordering any of them registers as
 * nothing at all.
 *
 * WHAT NEVER REGISTERS: annotations. Descriptions, summaries, titles, examples, defaults,
 * deprecation flags, vendor extensions, `info`, and the `openapi` dialect field itself (3.0.2
 * to 3.0.4 is an edit to the document, not to the API) are not contract, and a real history is
 * full of edits to them. A diff that flags a typo fix is a gate a team switches off, and the
 * done-when of T038 is the opposite property. A document's `servers` are the one exception on
 * the document level: a moved base URL is a change every reader acts on, so servers changes
 * register, always as non breaking. The exception is the url and what is served over it, never
 * the prose: a server's own `description` is an annotation like any other and registers nothing.
 *
 * WHAT CAN BREAK THE GATE IS EXACTLY THE SET SPEC 17.1 NAMES, and every other detected change is
 * recorded as non breaking rather than dropped. Two rules bound the breaking set on purpose:
 *
 * - direction: a removal breaks a reader, so it needs the schema to be reachable from a
 *   response; a new obligation breaks a sender, so it needs reachability from a request.
 *   Reachability is computed on both versions and unioned, and a schema reachable from neither
 *   side can break nobody.
 * - presence: only a keyword present on both sides can break the gate. A `type` or an `enum`
 *   appearing where there was none is documentation tightening as often as it is a contract
 *   change, so it is recorded as a constraints change instead of guessed at.
 *
 * A CHANGE TO A NAMED SCHEMA IS CLASSIFIED ONCE, UNDER ITS NAME, which is the model decision
 * SPEC 5.1.1 makes for exactly this consumer. At a use site, two references to the same name
 * are not compared again; two references to different names are compared structurally after
 * resolution, and when the resolved shapes are identical the change is silent, because a pure
 * rename does not change the contract on the wire.
 *
 * OPERATIONS ARE MATCHED WITH TEMPLATE VARIABLE NAMES ERASED, `/users/{id}` and
 * `/users/{userId}` being one URL shape, and path parameters are then matched positionally, so
 * renaming a template variable produces an empty diff instead of a phantom removed operation
 * with a phantom added required parameter.
 *
 * OUT OF SCOPE, SAID RATHER THAN DISCOVERED: channels (M5), webhooks, response headers, and
 * callback trees are not diffed yet. Webhook and node request and response slots do feed the
 * reachability computation, so their schemas still classify with the right direction.
 */

import { canonicalize } from '../../hashing/domain/canonical';
import type { IRDocument, IRSecurityScheme, IRServer } from '../../ir/domain/document.types';
import type {
  IRMediaType,
  IROperation,
  IRParameter,
  IRResponse,
  IRSecurityRequirement,
} from '../../ir/domain/node.types';
import type { IRJsonSchema, IRJsonValue, IRSchemaSlot } from '../../ir/domain/schema.types';

/** Which side of the gate a change falls on. */
export type IRDiffClassification = 'breaking' | 'non-breaking';

/** Every kind of change the engine reports. The breaking ones are the SPEC 17.1 set. */
export type IRDiffChangeKind =
  | 'operation-removed'
  | 'operation-added'
  | 'response-field-removed'
  | 'type-changed'
  | 'required-property-added'
  | 'optional-property-added'
  | 'property-removed'
  | 'requiredness-changed'
  | 'enum-narrowed'
  | 'enum-widened'
  | 'variant-removed'
  | 'variant-added'
  | 'required-parameter-added'
  | 'optional-parameter-added'
  | 'parameter-removed'
  | 'response-removed'
  | 'response-added'
  | 'media-type-removed'
  | 'media-type-added'
  | 'security-scheme-removed'
  | 'security-scheme-added'
  | 'security-scheme-changed'
  | 'server-removed'
  | 'server-added'
  | 'server-changed'
  | 'operation-security-changed'
  | 'operation-unread'
  | 'constraints-changed';

/** One reported change, self contained: a consumer renders it without loading either document. */
export interface IRDiffChange {
  readonly kind: IRDiffChangeKind;
  readonly classification: IRDiffClassification;
  /** Human readable subject: `User.email`, `GET /users`, `query parameter q of GET /users`. */
  readonly subject: string;
  /** What it was, for the `old → new` kinds. */
  readonly oldValue?: string;
  /** What it is now. */
  readonly newValue?: string;
  /** The values that left or arrived, for the enum and variant kinds. */
  readonly values?: readonly string[];
}

/** The whole report, both sections already in their stable rendering order. */
export interface IRDiffReport {
  readonly breaking: readonly IRDiffChange[];
  readonly nonBreaking: readonly IRDiffChange[];
}

/**
 * Rendering order of the kinds inside each section, subject as tie break.
 *
 * The order reproduces the SPEC 17.1 example exactly on the example's own input: removed
 * operations first, then what a reader loses, then what changed, then new obligations.
 */
const KIND_ORDER: readonly IRDiffChangeKind[] = [
  'operation-removed',
  'operation-added',
  'response-field-removed',
  'type-changed',
  'required-property-added',
  'optional-property-added',
  'property-removed',
  'requiredness-changed',
  'enum-narrowed',
  'enum-widened',
  'variant-removed',
  'variant-added',
  'required-parameter-added',
  'optional-parameter-added',
  'parameter-removed',
  'response-removed',
  'response-added',
  'media-type-removed',
  'media-type-added',
  'security-scheme-removed',
  'security-scheme-added',
  'security-scheme-changed',
  'server-removed',
  'server-added',
  'server-changed',
  'operation-security-changed',
  'operation-unread',
  'constraints-changed',
];

/** Whether a schema position can be reached from requests, from responses, from both or neither. */
interface ReachFlags {
  readonly request: boolean;
  readonly response: boolean;
}

/** Builds one subject string from an accumulated path inside a schema. */
type SubjectOf = (path: string) => string;

/** Everything the recursive walk needs in hand. */
interface DiffContext {
  readonly oldDocument: IRDocument;
  readonly newDocument: IRDocument;
  readonly changes: IRDiffChange[];
}

/** Contract keys compared structurally by the recursive walk itself. */
const WALKED_KEYS: ReadonlySet<string> = new Set([
  '$ref',
  '$cycle',
  'type',
  'enum',
  'const',
  'required',
  'properties',
  'items',
  'prefixItems',
  'oneOf',
  'anyOf',
]);

/**
 * Turns a change into its identity, so one fact reported from two positions collapses to one.
 */
function changeKey(change: IRDiffChange): string {
  return [
    change.kind,
    change.subject,
    change.oldValue ?? '',
    change.newValue ?? '',
    ...(change.values ?? []),
  ].join('\u0000');
}

/**
 * Compares two versions of one document and classifies every change, per SPEC 17.1.
 *
 * @param oldDocument - The earlier version, already normalized
 * @param newDocument - The later version
 * @returns Breaking and non breaking changes, each section in stable rendering order
 */
export function buildDiffReport(oldDocument: IRDocument, newDocument: IRDocument): IRDiffReport {
  const context: DiffContext = { oldDocument, newDocument, changes: [] };
  const flagsByName = unionReachability(oldDocument, newDocument);

  diffOperations(context);
  diffNamedSchemas(context, flagsByName);
  diffSecuritySchemes(context);
  diffServers(context);

  const seen = new Set<string>();
  const unique = context.changes.filter((change) => {
    const key = changeKey(change);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const rank = new Map(KIND_ORDER.map((kind, index) => [kind, index]));
  const ordered = [...unique].sort((left, right) => {
    const byKind = (rank.get(left.kind) ?? 0) - (rank.get(right.kind) ?? 0);
    if (byKind !== 0) return byKind;
    if (left.subject !== right.subject) return left.subject < right.subject ? -1 : 1;
    return changeKey(left) < changeKey(right) ? -1 : 1;
  });

  return {
    breaking: ordered.filter((change) => change.classification === 'breaking'),
    nonBreaking: ordered.filter((change) => change.classification === 'non-breaking'),
  };
}

/** Adds one change. */
function emit(context: DiffContext, change: IRDiffChange): void {
  context.changes.push(change);
}

/** `breaking` when the condition holds, recorded otherwise. */
function classify(breaking: boolean): IRDiffClassification {
  return breaking ? 'breaking' : 'non-breaking';
}

/* ------------------------------------------------------------------------------------------ */
/* Reachability                                                                                */
/* ------------------------------------------------------------------------------------------ */

/** Named schemas reachable from requests and from responses, unioned over both versions. */
function unionReachability(
  oldDocument: IRDocument,
  newDocument: IRDocument,
): ReadonlyMap<string, ReachFlags> {
  const older = reachability(oldDocument);
  const newer = reachability(newDocument);

  const names = new Set([...older.request, ...older.response, ...newer.request, ...newer.response]);

  const flags = new Map<string, ReachFlags>();
  for (const name of names) {
    flags.set(name, {
      request: older.request.has(name) || newer.request.has(name),
      response: older.response.has(name) || newer.response.has(name),
    });
  }

  return flags;
}

/** Named schemas reachable from request positions and from response positions of one document. */
function reachability(document: IRDocument): {
  readonly request: ReadonlySet<string>;
  readonly response: ReadonlySet<string>;
} {
  const requestRoots: string[] = [];
  const responseRoots: string[] = [];

  const operations: IROperation[] = [];
  for (const node of document.nodes.values()) {
    if (node.kind === 'operation') operations.push(node);
  }
  for (const node of document.webhooks.values()) {
    if (node.kind === 'operation') operations.push(node);
  }

  for (const operation of operations) {
    for (const parameter of operation.parameters) {
      collectSlotNames(parameter.schema, requestRoots);
    }
    for (const media of operation.requestBody?.content ?? []) {
      collectSlotNames(media.schema, requestRoots);
    }
    for (const response of operation.responses) {
      for (const media of response.content) collectSlotNames(media.schema, responseRoots);
      for (const header of response.headers ?? []) collectSlotNames(header.schema, responseRoots);
      collectSlotNames(response.itemSchema, responseRoots);
    }
  }

  return {
    request: closure(document, requestRoots),
    response: closure(document, responseRoots),
  };
}

/** Names a slot mentions: the name itself, or every reference inside an inline body. */
function collectSlotNames(slot: IRSchemaSlot | undefined, into: string[]): void {
  if (slot === undefined) return;
  if (slot.kind === 'named') {
    into.push(slot.schemaId);
    return;
  }
  if (slot.schema.normalized !== undefined) collectReferences(slot.schema.normalized, into);
}

/** Every named schema a body refers to, walking only schema positions rather than data. */
function collectReferences(body: IRJsonSchema, into: string[]): void {
  if (body.$ref !== undefined) into.push(body.$ref);
  if (body.$cycle !== undefined) into.push(body.$cycle);

  for (const child of Object.values(body.properties ?? {})) collectReferences(child, into);
  for (const child of Object.values(body.patternProperties ?? {})) collectReferences(child, into);
  if (body.propertyNames !== undefined) collectReferences(body.propertyNames, into);
  if (typeof body.additionalProperties === 'object') {
    collectReferences(body.additionalProperties, into);
  }
  if (body.items !== undefined) collectReferences(body.items, into);
  for (const child of body.prefixItems ?? []) collectReferences(child, into);
  for (const child of body.allOf ?? []) collectReferences(child, into);
  for (const child of body.oneOf ?? []) collectReferences(child, into);
  for (const child of body.anyOf ?? []) collectReferences(child, into);
  if (body.not !== undefined) collectReferences(body.not, into);
  if (body.if !== undefined) collectReferences(body.if, into);
  if (body.then !== undefined) collectReferences(body.then, into);
  if (body.else !== undefined) collectReferences(body.else, into);
}

/** Transitive closure over the named schema graph, starting from the given roots. */
function closure(document: IRDocument, roots: readonly string[]): ReadonlySet<string> {
  const reached = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const name = queue.pop();
    if (name === undefined || reached.has(name)) continue;
    reached.add(name);

    const body = document.schemas.get(name)?.normalized;
    if (body === undefined) continue;

    const found: string[] = [];
    collectReferences(body, found);
    queue.push(...found);
  }

  return reached;
}

/** The union flags for a named schema, or unreachable when neither version reaches it. */
function flagsFor(flags: ReadonlyMap<string, ReachFlags>, name: string): ReachFlags {
  return flags.get(name) ?? { request: false, response: false };
}

/* ------------------------------------------------------------------------------------------ */
/* Schema comparison                                                                           */
/* ------------------------------------------------------------------------------------------ */

/**
 * The canonical text of a body with annotations dropped and every set shaped keyword sorted.
 *
 * This is the equality the engine uses for whole subtrees: resolved references, `oneOf` and
 * `anyOf` branches, and the residual constraint comparison. Two bodies with this text equal
 * are the same contract.
 */
function strippedCanonical(body: IRJsonSchema): string {
  return canonicalize(stripBody(body));
}

/** {@link strippedCanonical}'s recursive half, returning a plain comparable structure. */
function stripBody(body: IRJsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (body.$ref !== undefined) out.$ref = body.$ref;
  if (body.$cycle !== undefined) out.$cycle = body.$cycle;

  const types = typeSet(body);
  if (types.length > 0) out.type = types;

  const values = effectiveEnum(body);
  if (values !== undefined) out.enum = values.map((value) => canonicalize(value)).sort();

  if (body.required !== undefined) out.required = [...body.required].sort();

  if (body.properties !== undefined) {
    out.properties = mapValues(body.properties, stripBody);
  }
  if (body.patternProperties !== undefined) {
    out.patternProperties = mapValues(body.patternProperties, stripBody);
  }
  if (body.propertyNames !== undefined) out.propertyNames = stripBody(body.propertyNames);
  if (body.additionalProperties !== undefined) {
    out.additionalProperties =
      typeof body.additionalProperties === 'object'
        ? stripBody(body.additionalProperties)
        : body.additionalProperties;
  }
  if (body.dependentRequired !== undefined) {
    out.dependentRequired = mapValues(body.dependentRequired, (names) => [...names].sort());
  }

  if (body.items !== undefined) out.items = stripBody(body.items);
  if (body.prefixItems !== undefined) out.prefixItems = body.prefixItems.map(stripBody);

  if (body.oneOf !== undefined) out.oneOf = sortedBranches(body.oneOf);
  if (body.anyOf !== undefined) out.anyOf = sortedBranches(body.anyOf);
  if (body.allOf !== undefined) out.allOf = sortedBranches(body.allOf);
  if (body.not !== undefined) out.not = stripBody(body.not);
  if (body.if !== undefined) out.if = stripBody(body.if);
  if (body.then !== undefined) out.then = stripBody(body.then);
  if (body.else !== undefined) out.else = stripBody(body.else);

  for (const key of RESIDUAL_SCALAR_KEYS) {
    const value = (body as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  if (body.discriminator !== undefined) out.discriminator = body.discriminator;

  // readOnly and writeOnly move a field between the two views of SPEC 5.4, which is contract,
  // so they survive the strip even though they read like flags.
  if (body.readOnly !== undefined) out.readOnly = body.readOnly;
  if (body.writeOnly !== undefined) out.writeOnly = body.writeOnly;

  return out;
}

/** Branches as a set: stripped, then sorted by their canonical text. */
function sortedBranches(branches: readonly IRJsonSchema[]): readonly Record<string, unknown>[] {
  return branches
    .map((branch) => stripBody(branch))
    .sort((left, right) => (canonicalize(left) < canonicalize(right) ? -1 : 1));
}

/** Applies a function to every value of a record, keeping the keys. */
function mapValues<T, U>(
  record: Readonly<Record<string, T>>,
  transform: (value: T) => U,
): Record<string, U> {
  const out: Record<string, U> = {};
  for (const [key, value] of Object.entries(record)) out[key] = transform(value);
  return out;
}

/** Scalar constraint keywords compared as one residual block. */
const RESIDUAL_SCALAR_KEYS: readonly (keyof IRJsonSchema)[] = [
  'format',
  'minProperties',
  'maxProperties',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
];

/** The declared type as a sorted list, empty when the keyword is absent. */
function typeSet(body: IRJsonSchema): readonly string[] {
  if (body.type === undefined) return [];
  const list: readonly string[] = typeof body.type === 'string' ? [body.type] : body.type;
  return [...new Set(list)].sort();
}

/** A type set as prose: `string`, `null | string`, or `untyped`. */
function typeText(types: readonly string[]): string {
  return types.length === 0 ? 'untyped' : types.join(' | ');
}

/** `const` folded into `enum`: a const is an enum of one. */
function effectiveEnum(body: IRJsonSchema): readonly IRJsonValue[] | undefined {
  if (body.const !== undefined) return [body.const];
  return body.enum;
}

/** One enum value as prose: bare for a string, canonical JSON for anything else. */
function renderValue(value: IRJsonValue): string {
  return typeof value === 'string' ? value : canonicalize(value);
}

/** Follows `$ref` hops to the body a reference stands for, keeping cycles as their marker. */
function resolveBody(document: IRDocument, body: IRJsonSchema): IRJsonSchema {
  let current = body;
  const seen = new Set<string>();

  while (current.$ref !== undefined && !seen.has(current.$ref)) {
    seen.add(current.$ref);
    const target = document.schemas.get(current.$ref)?.normalized;
    if (target === undefined) return current;
    current = target;
  }

  return current;
}

/** A body as prose for the `old → new` line: its name when it has one, its type otherwise. */
function describeBody(body: IRJsonSchema): string {
  if (body.$ref !== undefined) return body.$ref;
  if (body.$cycle !== undefined) return body.$cycle;
  return typeText(typeSet(body));
}

/** A branch of a `oneOf` or `anyOf` as prose, best name first. */
function describeBranch(body: IRJsonSchema): string {
  if (body.$ref !== undefined) return body.$ref;
  if (body.$cycle !== undefined) return body.$cycle;
  if (body.title !== undefined) return body.title;
  return typeText(typeSet(body));
}

/** Appends a property name to a subject path. */
function childPath(path: string, name: string): string {
  return path === '' ? name : `${path}.${name}`;
}

/**
 * Compares two schema bodies at one position and everything under it.
 *
 * @param context - Both documents and the change sink
 * @param oldBody - The position in the earlier version
 * @param newBody - The position in the later version
 * @param path - Accumulated path inside the schema, empty at its root
 * @param subject - Turns a path into the reported subject
 * @param flags - Which directions this position is reachable from
 */
function diffBodies(
  context: DiffContext,
  oldBody: IRJsonSchema,
  newBody: IRJsonSchema,
  path: string,
  subject: SubjectOf,
  flags: ReachFlags,
): void {
  const oldRef = oldBody.$ref ?? oldBody.$cycle;
  const newRef = newBody.$ref ?? newBody.$cycle;

  if (oldRef !== undefined || newRef !== undefined) {
    if (oldRef !== undefined && oldRef === newRef) return;

    const resolvedOld = resolveBody(context.oldDocument, oldBody);
    const resolvedNew = resolveBody(context.newDocument, newBody);
    if (strippedCanonical(resolvedOld) === strippedCanonical(resolvedNew)) return;

    emit(context, {
      kind: 'type-changed',
      classification: classify(flags.request || flags.response),
      subject: subject(path),
      oldValue: describeBody(oldBody),
      newValue: describeBody(newBody),
    });
    return;
  }

  const oldTypes = typeSet(oldBody);
  const newTypes = typeSet(newBody);
  if (oldTypes.length > 0 && newTypes.length > 0 && typeText(oldTypes) !== typeText(newTypes)) {
    emit(context, {
      kind: 'type-changed',
      classification: classify(flags.request || flags.response),
      subject: subject(path),
      oldValue: typeText(oldTypes),
      newValue: typeText(newTypes),
    });
    return;
  }

  diffEnums(context, oldBody, newBody, path, subject, flags);
  diffProperties(context, oldBody, newBody, path, subject, flags);
  diffItems(context, oldBody, newBody, path, subject, flags);
  diffVariants(context, oldBody, newBody, path, subject, flags);
  diffResidual(context, oldBody, newBody, path, subject);
}

/** The enum comparison: values as a set, and only a set present on both sides can break. */
function diffEnums(
  context: DiffContext,
  oldBody: IRJsonSchema,
  newBody: IRJsonSchema,
  path: string,
  subject: SubjectOf,
  flags: ReachFlags,
): void {
  const oldValues = effectiveEnum(oldBody);
  const newValues = effectiveEnum(newBody);
  if (oldValues === undefined || newValues === undefined) return;

  const oldByKey = new Map(oldValues.map((value) => [canonicalize(value), value]));
  const newByKey = new Map(newValues.map((value) => [canonicalize(value), value]));

  const removed = [...oldByKey.entries()]
    .filter(([key]) => !newByKey.has(key))
    .map(([, value]) => renderValue(value))
    .sort();
  const added = [...newByKey.entries()]
    .filter(([key]) => !oldByKey.has(key))
    .map(([, value]) => renderValue(value))
    .sort();

  if (removed.length > 0) {
    emit(context, {
      kind: 'enum-narrowed',
      classification: classify(flags.request),
      subject: subject(path),
      values: removed,
    });
  }
  if (added.length > 0) {
    emit(context, {
      kind: 'enum-widened',
      classification: 'non-breaking',
      subject: subject(path),
      values: added,
    });
  }
}

/** Property membership, requiredness, and the recursion into common properties. */
function diffProperties(
  context: DiffContext,
  oldBody: IRJsonSchema,
  newBody: IRJsonSchema,
  path: string,
  subject: SubjectOf,
  flags: ReachFlags,
): void {
  const oldProps = oldBody.properties ?? {};
  const newProps = newBody.properties ?? {};
  const oldRequired = new Set(oldBody.required ?? []);
  const newRequired = new Set(newBody.required ?? []);

  for (const name of Object.keys(oldProps).sort()) {
    if (name in newProps) continue;
    emit(
      context,
      flags.response
        ? {
            kind: 'response-field-removed',
            classification: 'breaking',
            subject: subject(childPath(path, name)),
          }
        : {
            kind: 'property-removed',
            classification: 'non-breaking',
            subject: subject(childPath(path, name)),
          },
    );
  }

  for (const name of Object.keys(newProps).sort()) {
    if (name in oldProps) continue;
    emit(
      context,
      newRequired.has(name)
        ? {
            kind: 'required-property-added',
            classification: classify(flags.request),
            subject: subject(childPath(path, name)),
          }
        : {
            kind: 'optional-property-added',
            classification: 'non-breaking',
            subject: subject(childPath(path, name)),
          },
    );
  }

  for (const name of Object.keys(oldProps).sort()) {
    const newChild = newProps[name];
    const oldChild = oldProps[name];
    if (newChild === undefined || oldChild === undefined) continue;

    const was = oldRequired.has(name);
    const is = newRequired.has(name);
    if (was !== is) {
      emit(context, {
        kind: 'requiredness-changed',
        classification: classify(is && flags.request),
        subject: subject(childPath(path, name)),
        oldValue: was ? 'required' : 'optional',
        newValue: is ? 'required' : 'optional',
      });
    }

    diffBodies(context, oldChild, newChild, childPath(path, name), subject, flags);
  }
}

/** `items` and `prefixItems`, positional on purpose. */
function diffItems(
  context: DiffContext,
  oldBody: IRJsonSchema,
  newBody: IRJsonSchema,
  path: string,
  subject: SubjectOf,
  flags: ReachFlags,
): void {
  if (oldBody.items !== undefined && newBody.items !== undefined) {
    diffBodies(context, oldBody.items, newBody.items, `${path}[]`, subject, flags);
  } else if (oldBody.items !== undefined || newBody.items !== undefined) {
    emit(context, {
      kind: 'constraints-changed',
      classification: 'non-breaking',
      subject: subject(path),
    });
  }

  const oldPrefix = oldBody.prefixItems ?? [];
  const newPrefix = newBody.prefixItems ?? [];
  const shared = Math.min(oldPrefix.length, newPrefix.length);
  for (let index = 0; index < shared; index += 1) {
    const oldChild = oldPrefix[index];
    const newChild = newPrefix[index];
    if (oldChild === undefined || newChild === undefined) continue;
    diffBodies(context, oldChild, newChild, `${path}[${String(index)}]`, subject, flags);
  }
  if (oldPrefix.length !== newPrefix.length) {
    emit(context, {
      kind: 'constraints-changed',
      classification: 'non-breaking',
      subject: subject(path),
    });
  }
}

/** `oneOf` and `anyOf` branches as sets: a shape leaving is a narrowing, one arriving widens. */
function diffVariants(
  context: DiffContext,
  oldBody: IRJsonSchema,
  newBody: IRJsonSchema,
  path: string,
  subject: SubjectOf,
  flags: ReachFlags,
): void {
  for (const keyword of ['oneOf', 'anyOf'] as const) {
    const oldBranches = oldBody[keyword];
    const newBranches = newBody[keyword];
    if (oldBranches === undefined || newBranches === undefined) continue;

    const oldByKey = new Map(oldBranches.map((branch) => [strippedCanonical(branch), branch]));
    const newByKey = new Map(newBranches.map((branch) => [strippedCanonical(branch), branch]));

    const removed = [...oldByKey.entries()]
      .filter(([key]) => !newByKey.has(key))
      .map(([, branch]) => describeBranch(branch))
      .sort();
    const added = [...newByKey.entries()]
      .filter(([key]) => !oldByKey.has(key))
      .map(([, branch]) => describeBranch(branch))
      .sort();

    if (removed.length > 0) {
      emit(context, {
        kind: 'variant-removed',
        classification: classify(flags.request),
        subject: subject(path),
        values: removed,
      });
    }
    if (added.length > 0) {
      emit(context, {
        kind: 'variant-added',
        classification: 'non-breaking',
        subject: subject(path),
        values: added,
      });
    }
  }
}

/**
 * Everything contract bearing that no specific kind covers, compared as one block.
 *
 * A difference here is recorded and never breaks the gate. That includes a keyword appearing or
 * disappearing: `type` arriving where there was none, an `enum` being dropped, `if`/`then`
 * conditions moving. See the header for why presence changes are recorded rather than gated.
 */
function diffResidual(
  context: DiffContext,
  oldBody: IRJsonSchema,
  newBody: IRJsonSchema,
  path: string,
  subject: SubjectOf,
): void {
  if (canonicalize(residualOf(oldBody)) === canonicalize(residualOf(newBody))) return;

  emit(context, {
    kind: 'constraints-changed',
    classification: 'non-breaking',
    subject: subject(path),
  });
}

/** The residual: every stripped contract key the walk does not compare on its own. */
function residualOf(body: IRJsonSchema): Record<string, unknown> {
  const whole = stripBody(body);
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(whole)) {
    if (WALKED_KEYS.has(key)) continue;
    out[key] = value;
  }

  // Presence of the walked keywords is part of the residual, so `type` or `enum` appearing or
  // disappearing is recorded here even though a change in their content is classified above.
  for (const key of ['type', 'enum', 'oneOf', 'anyOf'] as const) {
    out[`has:${key}`] = body[key] !== undefined || (key === 'enum' && body.const !== undefined);
  }

  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* Slots                                                                                       */
/* ------------------------------------------------------------------------------------------ */

/** A slot as a comparable body: a reference for a named slot, the inline body otherwise. */
function slotBody(slot: IRSchemaSlot): IRJsonSchema | undefined {
  return slot.kind === 'named' ? { $ref: slot.schemaId } : slot.schema.normalized;
}

/** Compares two schema slots at one use site. */
function diffSlot(
  context: DiffContext,
  oldSlot: IRSchemaSlot | undefined,
  newSlot: IRSchemaSlot | undefined,
  site: string,
  flags: ReachFlags,
): void {
  if (oldSlot === undefined && newSlot === undefined) return;

  const subject: SubjectOf = (path) => (path === '' ? site : `${path} of ${site}`);

  if (oldSlot === undefined || newSlot === undefined) {
    emit(context, {
      kind: 'constraints-changed',
      classification: 'non-breaking',
      subject: subject(''),
    });
    return;
  }

  const oldBody = slotBody(oldSlot);
  const newBody = slotBody(newSlot);

  if (oldBody === undefined || newBody === undefined) {
    // A raw, non JSON Schema dialect on either side: the only honest comparison is textual.
    const oldRaw = oldSlot.kind === 'inline' ? (oldSlot.schema.raw ?? null) : null;
    const newRaw = newSlot.kind === 'inline' ? (newSlot.schema.raw ?? null) : null;
    if (canonicalize(oldRaw) !== canonicalize(newRaw)) {
      emit(context, {
        kind: 'constraints-changed',
        classification: 'non-breaking',
        subject: subject(''),
      });
    }
    return;
  }

  diffBodies(context, oldBody, newBody, '', subject, flags);
}

/* ------------------------------------------------------------------------------------------ */
/* Operations                                                                                  */
/* ------------------------------------------------------------------------------------------ */

const REQUEST_FLAGS: ReachFlags = { request: true, response: false };
const RESPONSE_FLAGS: ReachFlags = { request: false, response: true };

/** `GET /users/{id}` for a reader. */
function operationSubject(operation: IROperation): string {
  return `${operation.method.toUpperCase()} ${operation.path}`;
}

/** The matching key: method plus the path with template variable names erased. */
function operationKey(operation: IROperation): string {
  return `${operation.method} ${operation.path.replace(/\{[^}]*\}/g, '{}')}`;
}

/** Every HTTP operation of a document, channels left to M5. */
function operationsOf(document: IRDocument): readonly IROperation[] {
  const operations: IROperation[] = [];
  for (const node of document.nodes.values()) {
    if (node.kind === 'operation') operations.push(node);
  }
  return operations;
}

/**
 * The matching keys of the operations a document declares and this normalizer would not read.
 *
 * SO A KEY THAT CHANGED CASE IS NOT A DELETION, per SPEC 7.1's `operation-key-unread` as added by
 * `T043`. Before it, renaming `get` to `GET` dropped the operation out of the IR and `diff` called
 * it a removed operation, which failed the gate on a breaking change nobody made: the contract on
 * the wire did not move at all, one key was misspelled. The defect has its own rule, its own code
 * and its own `lint` failure, and this is where the diff stops reporting it as a second thing it
 * is not.
 *
 * THE EXACT PATH, NOT THE MATCHING KEY. Operations pair on the path with template variable names
 * erased, so `/users/{id}` and `/users/{name}` share one bucket; keying this on the same erased
 * form would have let one misspelled key downgrade every unmatched removal in that bucket, hiding
 * a real deletion behind a typo in its sibling. Residual, recorded in SPEC 17.1: renaming a
 * template variable and changing the key's case in one commit still reads as a removal, which is
 * the safe direction to fail in.
 *
 * @param document - Either version
 * @returns The keys, as `<method> <path>` exactly as the document wrote the path
 */
function unreadKeysOf(document: IRDocument): ReadonlySet<string> {
  return new Set((document.unreadKeys ?? []).map((entry) => `${entry.method} ${entry.path}`));
}

/** Groups operations by their matching key. */
function bucketByKey(operations: readonly IROperation[]): Map<string, IROperation[]> {
  const buckets = new Map<string, IROperation[]>();
  for (const operation of operations) {
    const key = operationKey(operation);
    const bucket = buckets.get(key) ?? [];
    bucket.push(operation);
    buckets.set(key, bucket);
  }
  return buckets;
}

/**
 * Pairs the operations of two versions and diffs each pair.
 *
 * Within one key, exact path matches pair first, then the rest pair in sorted path order, so
 * two sibling templates that erase to one key still match deterministically.
 */
function diffOperations(context: DiffContext): void {
  const oldBuckets = bucketByKey(operationsOf(context.oldDocument));
  const newBuckets = bucketByKey(operationsOf(context.newDocument));
  const newUnread = unreadKeysOf(context.newDocument);
  const keys = [...new Set([...oldBuckets.keys(), ...newBuckets.keys()])].sort();

  for (const key of keys) {
    const olds = [...(oldBuckets.get(key) ?? [])].sort((a, b) => (a.path < b.path ? -1 : 1));
    const news = [...(newBuckets.get(key) ?? [])].sort((a, b) => (a.path < b.path ? -1 : 1));

    const matchedNew = new Set<IROperation>();
    const pairs: [IROperation, IROperation][] = [];
    const unmatchedOld: IROperation[] = [];

    for (const older of olds) {
      const exact = news.find(
        (candidate) => !matchedNew.has(candidate) && candidate.path === older.path,
      );
      if (exact !== undefined) {
        matchedNew.add(exact);
        pairs.push([older, exact]);
      } else {
        unmatchedOld.push(older);
      }
    }
    for (const older of [...unmatchedOld]) {
      const positional = news.find((candidate) => !matchedNew.has(candidate));
      if (positional !== undefined) {
        matchedNew.add(positional);
        pairs.push([older, positional]);
        unmatchedOld.splice(unmatchedOld.indexOf(older), 1);
      }
    }

    for (const older of unmatchedOld) {
      // NOT REMOVED, JUST UNREADABLE. The new version still declares this operation; it declares
      // it under a key OpenAPI does not spell that way, so nothing read it. Reported so the run
      // is not silent about a real edit, and non breaking because the wire contract did not move.
      if (newUnread.has(`${older.method} ${older.path}`)) {
        emit(context, {
          kind: 'operation-unread',
          classification: 'non-breaking',
          subject: operationSubject(older),
        });
        continue;
      }

      emit(context, {
        kind: 'operation-removed',
        classification: 'breaking',
        subject: operationSubject(older),
      });
    }
    for (const newer of news) {
      if (matchedNew.has(newer)) continue;
      emit(context, {
        kind: 'operation-added',
        classification: 'non-breaking',
        subject: operationSubject(newer),
      });
    }

    for (const [older, newer] of pairs) diffOperationPair(context, older, newer);
  }
}

/** Diffs one matched pair of operations. */
function diffOperationPair(context: DiffContext, older: IROperation, newer: IROperation): void {
  const site = operationSubject(newer);

  diffParameters(context, older, newer, site);
  diffRequestBody(context, older, newer, site);
  diffResponses(context, older, newer, site);
  diffOperationSecurity(context, older, newer, site);
}

/** `query parameter q of GET /users`. */
function parameterSubject(parameter: IRParameter, site: string): string {
  return `${parameter.in} parameter ${parameter.name} of ${site}`;
}

/** Path parameters in the order their variables appear in the path template. */
function pathParametersInOrder(operation: IROperation): readonly IRParameter[] {
  const pathParams = operation.parameters.filter((parameter) => parameter.in === 'path');
  const positions = new Map<string, number>();
  const pattern = /\{([^}]*)\}/g;
  let match = pattern.exec(operation.path);
  let index = 0;
  while (match !== null) {
    positions.set(match[1] ?? '', index);
    index += 1;
    match = pattern.exec(operation.path);
  }

  return [...pathParams].sort((left, right) => {
    const a = positions.get(left.name) ?? Number.MAX_SAFE_INTEGER;
    const b = positions.get(right.name) ?? Number.MAX_SAFE_INTEGER;
    return a - b;
  });
}

/** Parameter membership and change, path parameters matched positionally. */
function diffParameters(
  context: DiffContext,
  older: IROperation,
  newer: IROperation,
  site: string,
): void {
  const oldPath = pathParametersInOrder(older);
  const newPath = pathParametersInOrder(newer);
  const sharedPath = Math.min(oldPath.length, newPath.length);

  const pairs: [IRParameter, IRParameter][] = [];
  for (let index = 0; index < sharedPath; index += 1) {
    const from = oldPath[index];
    const to = newPath[index];
    if (from !== undefined && to !== undefined) pairs.push([from, to]);
  }
  const removed: IRParameter[] = oldPath.slice(sharedPath);
  const added: IRParameter[] = newPath.slice(sharedPath);

  const oldOthers = new Map(
    older.parameters
      .filter((parameter) => parameter.in !== 'path')
      .map((parameter) => [`${parameter.in} ${parameter.name}`, parameter]),
  );
  const newOthers = new Map(
    newer.parameters
      .filter((parameter) => parameter.in !== 'path')
      .map((parameter) => [`${parameter.in} ${parameter.name}`, parameter]),
  );

  for (const [key, parameter] of [...oldOthers.entries()].sort()) {
    const counterpart = newOthers.get(key);
    if (counterpart === undefined) removed.push(parameter);
    else pairs.push([parameter, counterpart]);
  }
  for (const [key, parameter] of [...newOthers.entries()].sort()) {
    if (!oldOthers.has(key)) added.push(parameter);
  }

  for (const parameter of removed) {
    emit(context, {
      kind: 'parameter-removed',
      classification: 'non-breaking',
      subject: parameterSubject(parameter, site),
    });
  }
  for (const parameter of added) {
    emit(
      context,
      parameter.required
        ? {
            kind: 'required-parameter-added',
            classification: 'breaking',
            subject: parameterSubject(parameter, site),
          }
        : {
            kind: 'optional-parameter-added',
            classification: 'non-breaking',
            subject: parameterSubject(parameter, site),
          },
    );
  }

  for (const [from, to] of pairs) {
    const subject = parameterSubject(to, site);

    if (from.required !== to.required) {
      emit(context, {
        kind: 'requiredness-changed',
        classification: classify(to.required),
        subject,
        oldValue: from.required ? 'required' : 'optional',
        newValue: to.required ? 'required' : 'optional',
      });
    }

    if (
      from.style !== to.style ||
      from.explode !== to.explode ||
      (from.allowReserved ?? false) !== (to.allowReserved ?? false)
    ) {
      emit(context, { kind: 'constraints-changed', classification: 'non-breaking', subject });
    }

    diffSlot(context, from.schema, to.schema, subject, REQUEST_FLAGS);
  }
}

/** The requiredness of a request body as a three state value. */
function bodyState(operation: IROperation): 'none' | 'optional' | 'required' {
  if (operation.requestBody === undefined) return 'none';
  return operation.requestBody.required ? 'required' : 'optional';
}

/** The request body: presence, requiredness, and its media types. */
function diffRequestBody(
  context: DiffContext,
  older: IROperation,
  newer: IROperation,
  site: string,
): void {
  const subject = `request body of ${site}`;
  const before = bodyState(older);
  const after = bodyState(newer);

  if (before !== after) {
    emit(context, {
      kind: 'requiredness-changed',
      classification: classify(after === 'required'),
      subject,
      oldValue: before,
      newValue: after,
    });
  }

  diffMediaTypes(
    context,
    older.requestBody?.content ?? [],
    newer.requestBody?.content ?? [],
    subject,
    REQUEST_FLAGS,
  );
}

/** Response codes and, per shared code, their media types and item schema. */
function diffResponses(
  context: DiffContext,
  older: IROperation,
  newer: IROperation,
  site: string,
): void {
  const oldByCode = new Map(older.responses.map((response) => [response.statusCode, response]));
  const newByCode = new Map(newer.responses.map((response) => [response.statusCode, response]));
  const codes = [...new Set([...oldByCode.keys(), ...newByCode.keys()])].sort();

  for (const code of codes) {
    const from = oldByCode.get(code);
    const to = newByCode.get(code);
    const subject = `response ${code} of ${site}`;

    if (from === undefined) {
      emit(context, { kind: 'response-added', classification: 'non-breaking', subject });
      continue;
    }
    if (to === undefined) {
      // Recorded and never gating, per SPEC 17.1: a removed declared code is a real change a
      // reader should see, and also the single most common documentation repair in a real
      // history, so gating on it is what would get the gate switched off.
      emit(context, { kind: 'response-removed', classification: 'non-breaking', subject });
      continue;
    }

    diffMediaTypes(context, from.content, to.content, subject, RESPONSE_FLAGS);
    diffItemSchema(context, from, to, subject);
  }
}

/** OpenAPI 3.2 `itemSchema`, compared like any slot under its own subject. */
function diffItemSchema(
  context: DiffContext,
  older: IRResponse,
  newer: IRResponse,
  subject: string,
): void {
  if (older.itemSchema === undefined && newer.itemSchema === undefined) return;
  diffSlot(
    context,
    older.itemSchema,
    newer.itemSchema,
    `item schema of ${subject}`,
    RESPONSE_FLAGS,
  );
}

/** Media types by name; a shared one has its schema compared, the rest are membership. */
function diffMediaTypes(
  context: DiffContext,
  older: readonly IRMediaType[],
  newer: readonly IRMediaType[],
  site: string,
  flags: ReachFlags,
): void {
  const oldByType = new Map(older.map((media) => [media.mediaType, media]));
  const newByType = new Map(newer.map((media) => [media.mediaType, media]));
  const names = [...new Set([...oldByType.keys(), ...newByType.keys()])].sort();

  for (const name of names) {
    const from = oldByType.get(name);
    const to = newByType.get(name);
    const membershipSubject = `media type ${name} of ${site}`;

    if (from === undefined) {
      emit(context, {
        kind: 'media-type-added',
        classification: 'non-breaking',
        subject: membershipSubject,
      });
      continue;
    }
    if (to === undefined) {
      emit(context, {
        kind: 'media-type-removed',
        classification: 'non-breaking',
        subject: membershipSubject,
      });
      continue;
    }

    const slotSite = name === 'application/json' ? site : `${site} (${name})`;
    diffSlot(context, from.schema, to.schema, slotSite, flags);
  }
}

/** Requirement lists as canonical text, order free on both levels. */
function securityText(requirements: readonly IRSecurityRequirement[]): string {
  const normalized = requirements
    .map((requirement) => ({
      schemeId: requirement.schemeId,
      scopes: [...requirement.scopes].sort(),
    }))
    .sort((left, right) => (canonicalize(left) < canonicalize(right) ? -1 : 1));
  return canonicalize(normalized);
}

/**
 * A changed security requirement list on an operation, recorded and never gating.
 *
 * Documenting auth that always existed is one of the most common specification repairs, and a
 * diff of two documents cannot tell that repair from a real new obligation, so this stays out
 * of the breaking set by the same reasoning SPEC 17.1 records for response removal.
 */
function diffOperationSecurity(
  context: DiffContext,
  older: IROperation,
  newer: IROperation,
  site: string,
): void {
  if (securityText(older.security) === securityText(newer.security)) return;

  emit(context, {
    kind: 'operation-security-changed',
    classification: 'non-breaking',
    subject: `security of ${site}`,
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Named schemas, security schemes and servers                                                 */
/* ------------------------------------------------------------------------------------------ */

/**
 * Diffs every named schema present in both versions, once, under its name.
 *
 * A name present on one side only gets no line of its own: if anything still uses it, the use
 * site reports the change; if nothing does, there is no contract to break.
 */
function diffNamedSchemas(context: DiffContext, flags: ReadonlyMap<string, ReachFlags>): void {
  const names = [...context.oldDocument.schemas.keys()]
    .filter((name) => context.newDocument.schemas.has(name))
    .sort();

  for (const name of names) {
    const older = context.oldDocument.schemas.get(name);
    const newer = context.newDocument.schemas.get(name);
    if (older === undefined || newer === undefined) continue;

    const subject: SubjectOf = (path) => {
      if (path === '') return name;
      return path.startsWith('[') ? `${name}${path}` : `${name}.${path}`;
    };

    if (older.normalized === undefined || newer.normalized === undefined) {
      if (canonicalize(older.raw ?? null) !== canonicalize(newer.raw ?? null)) {
        emit(context, {
          kind: 'constraints-changed',
          classification: 'non-breaking',
          subject: subject(''),
        });
      }
      continue;
    }

    diffBodies(context, older.normalized, newer.normalized, '', subject, flagsFor(flags, name));
  }
}

/** The four fields of a scheme a client puts on the wire. */
function wireFacing(scheme: IRSecurityScheme): Record<string, unknown> {
  return {
    type: scheme.type,
    ...(scheme.name === undefined ? {} : { name: scheme.name }),
    ...(scheme.in === undefined ? {} : { in: scheme.in }),
    ...(scheme.scheme === undefined ? {} : { scheme: scheme.scheme }),
  };
}

/** A scheme as prose for the `old → new` line. */
function describeScheme(scheme: IRSecurityScheme): string {
  return [scheme.type, scheme.in, scheme.name, scheme.scheme]
    .filter((part) => part !== undefined)
    .join(' ');
}

/** Scheme membership and change: wire facing fields break, the rest is recorded. */
function diffSecuritySchemes(context: DiffContext): void {
  const oldById = new Map(context.oldDocument.security.map((scheme) => [scheme.id, scheme]));
  const newById = new Map(context.newDocument.security.map((scheme) => [scheme.id, scheme]));
  const ids = [...new Set([...oldById.keys(), ...newById.keys()])].sort();

  for (const id of ids) {
    const older = oldById.get(id);
    const newer = newById.get(id);
    const subject = `security scheme ${id}`;

    if (older === undefined) {
      emit(context, { kind: 'security-scheme-added', classification: 'non-breaking', subject });
      continue;
    }
    if (newer === undefined) {
      emit(context, { kind: 'security-scheme-removed', classification: 'breaking', subject });
      continue;
    }

    if (canonicalize(wireFacing(older)) !== canonicalize(wireFacing(newer))) {
      emit(context, {
        kind: 'security-scheme-changed',
        classification: 'breaking',
        subject,
        oldValue: describeScheme(older),
        newValue: describeScheme(newer),
      });
      continue;
    }

    const softOld = {
      bearerFormat: older.bearerFormat ?? null,
      openIdConnectUrl: older.openIdConnectUrl ?? null,
      flows: older.flows ?? null,
    };
    const softNew = {
      bearerFormat: newer.bearerFormat ?? null,
      openIdConnectUrl: newer.openIdConnectUrl ?? null,
      flows: newer.flows ?? null,
    };
    if (canonicalize(softOld) !== canonicalize(softNew)) {
      emit(context, { kind: 'security-scheme-changed', classification: 'non-breaking', subject });
    }
  }
}

/**
 * A server as the record a reader depends on: where requests go, and over what protocol. The
 * variable enums sort like every other set shaped list, and `description`, the server's own and
 * a variable's alike, stays out, being an annotation like every other one per SPEC 17.1.
 */
function serverFacing(server: IRServer): Record<string, unknown> {
  return {
    url: server.url,
    ...(server.protocol === undefined ? {} : { protocol: server.protocol }),
    ...(server.protocolVersion === undefined ? {} : { protocolVersion: server.protocolVersion }),
    ...(server.variables === undefined
      ? {}
      : {
          variables: mapValues(server.variables, (variable) => ({
            default: variable.default,
            ...(variable.enum === undefined ? {} : { enum: [...variable.enum].sort() }),
          })),
        }),
  };
}

/**
 * A document's servers, recorded and never gating.
 *
 * Servers left the annotation set by a maintainer ruling on T038: a moved base URL is the one
 * document level change every reader acts on, because requests start going somewhere else, so
 * it has to print rather than pass in silence. It stays off the gate because a servers edit is
 * routinely a deployment fact catching up with the document rather than a contract change.
 *
 * The url is the only identity a server has, so matching is by url first, and the leftovers
 * pair in sorted url order, the way operations sharing one erased key do, which turns the
 * common single server url move into one `server-changed` line instead of a remove plus add.
 * Both lists compare as sets, so reordering the array registers nothing.
 */
function diffServers(context: DiffContext): void {
  const oldByUrl = new Map(context.oldDocument.servers.map((server) => [server.url, server]));
  const newByUrl = new Map(context.newDocument.servers.map((server) => [server.url, server]));

  const pairs: [IRServer, IRServer][] = [];
  const removed: IRServer[] = [];
  const added: IRServer[] = [];

  for (const [url, server] of [...oldByUrl.entries()].sort()) {
    const counterpart = newByUrl.get(url);
    if (counterpart === undefined) removed.push(server);
    else pairs.push([server, counterpart]);
  }
  for (const [url, server] of [...newByUrl.entries()].sort()) {
    if (!oldByUrl.has(url)) added.push(server);
  }

  const paired = Math.min(removed.length, added.length);
  for (let index = 0; index < paired; index += 1) {
    const from = removed[index];
    const to = added[index];
    if (from !== undefined && to !== undefined) pairs.push([from, to]);
  }

  for (const server of removed.slice(paired)) {
    emit(context, {
      kind: 'server-removed',
      classification: 'non-breaking',
      subject: `server ${server.url}`,
    });
  }
  for (const server of added.slice(paired)) {
    emit(context, {
      kind: 'server-added',
      classification: 'non-breaking',
      subject: `server ${server.url}`,
    });
  }

  for (const [from, to] of pairs) {
    if (canonicalize(serverFacing(from)) === canonicalize(serverFacing(to))) continue;

    emit(
      context,
      from.url === to.url
        ? { kind: 'server-changed', classification: 'non-breaking', subject: `server ${to.url}` }
        : {
            kind: 'server-changed',
            classification: 'non-breaking',
            subject: 'server',
            oldValue: from.url,
            newValue: to.url,
          },
    );
  }
}
